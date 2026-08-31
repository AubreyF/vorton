import {
  dataClassificationSchema,
  deriveDataClassification,
  installationRealmSchema,
  retrievedContextSchema,
  sourceCitationSchema,
  type ExecutiveWorkerJobRequest,
  type ExecutionAuthority,
  type InstallationRealm,
  type RetrievedContext,
  type SourceCitation,
} from "@vorton/contracts";
import type { Database, PersonContext } from "@vorton/database";
import { executiveCouncilProtocol } from "@vorton/executive";
import {
  type HindsightAdapter,
  type HindsightMemory,
  workspaceHindsightBank,
} from "@vorton/memory";

export interface ProposalInput {
  installationId: string;
  workspaceId: string;
  workId: string;
  workerId: string;
  roleId: string;
  objective: string;
  evidenceRecordIds: string[];
  background: boolean;
}

export class ExecutiveRequestInputError extends Error {}
export class ExecutiveRequestResolutionError extends Error {}

interface BindingRow {
  work_id: string;
  worker_id: string;
  role_id: string;
  role_name: string;
  role_version: number;
  skill_markdown: string;
  content_sha256: string;
  workspace_realm: unknown;
}

interface EvidenceRow {
  id: string;
  summary: string;
  source_uri: string | null;
  classification: ExecutiveWorkerJobRequest["evidence"][number]["classification"];
}

interface MemorySourceRow {
  source_revision_id: string;
  classification: string;
  source_uri: string;
  revision_hash: string;
  locator: string;
}

interface MemoryBankBindingRow {
  installation_id: string;
  workspace_id: string;
  installation_realm: unknown;
  external_bank_id: string;
}

interface GrantRow {
  policy_id: string;
  worker_id: string;
  capability: string;
  mode: ExecutionAuthority["mode"];
}

interface InstallationRow {
  installation_id: string;
  installation_slug: string;
  installation_display_name: string;
  workspace_id: string;
  workspace_slug: string;
  workspace_display_name: string;
  workspace_realm: "personal" | "organizational";
  person_kind: "owner" | "member";
}

interface BootstrapWorkRow {
  installation_id: string;
  workspace_id: string;
  id: string;
  title: string;
  requested_outcome: string;
  acceptance_criteria: unknown;
  state:
    | "proposed"
    | "ready"
    | "leased"
    | "blocked"
    | "review"
    | "completed"
    | "cancelled";
  priority: number;
  parent_work_id: string | null;
  custodian_name: string | null;
  custodian_kind: "person" | "worker" | null;
  updated_at: Date | string;
}

interface BootstrapBindingRow {
  installation_id: string;
  workspace_id: string;
  work_id: string;
  work_title: string;
  worker_id: string;
  worker_name: string;
  role_id: string;
  role_name: string;
}

interface BootstrapEvidenceRow extends EvidenceRow {
  installation_id: string;
  workspace_id: string;
  work_id: string | null;
}

export interface RuntimeBootstrap {
  installations: Array<{
    id: string;
    slug: string;
    displayName: string;
    workspaces: Array<{
      id: string;
      slug: string;
      displayName: string;
      realm: "personal" | "organizational";
      personKind: "owner" | "member";
      workItems: Array<{
        id: string;
        title: string;
        requestedOutcome: string;
        acceptanceCriteria: string[];
        state: BootstrapWorkRow["state"];
        priority: number;
        parentWorkId: string | null;
        custodianName: string | null;
        custodianKind: BootstrapWorkRow["custodian_kind"];
        updatedAt: string;
      }>;
      proposalBindings: Array<{
        workId: string;
        workTitle: string;
        workerId: string;
        workerName: string;
        roleId: string;
        roleName: string;
        evidence: Array<{
          id: string;
          summary: string;
          classification: string;
        }>;
      }>;
    }>;
  }>;
}

export class DatabaseExecutiveRequestResolver {
  constructor(
    private readonly database: Database,
    private readonly provider: string,
    private readonly model: string,
    private readonly memory: HindsightAdapter,
    private readonly onMemoryWarning: (error: unknown) => void = (error) =>
      console.warn(
        "Vorton derived memory recall is unavailable; continuing with authoritative evidence only",
        error,
      ),
  ) {}

  async resolveBootstrap(authUserId: string): Promise<RuntimeBootstrap> {
    return this.database.asPersonAcrossInstallations(
      authUserId,
      async (transaction) => {
        const installations = await transaction.query<InstallationRow>(
          `select installation.id as installation_id,
                  installation.slug as installation_slug,
                  installation.display_name as installation_display_name,
                  workspace.id as workspace_id,
                  workspace.slug as workspace_slug,
                  workspace.display_name as workspace_display_name,
                  workspace.realm as workspace_realm,
                  membership.kind as person_kind
           from public.people person
           join public.workspace_memberships membership
             on membership.installation_id = person.installation_id
            and membership.person_id = person.id
           join public.workspaces workspace
             on workspace.installation_id = membership.installation_id
            and workspace.id = membership.workspace_id
           join public.installations installation
             on installation.id = workspace.installation_id
          where person.auth_user_id = $1
          order by installation.display_name, workspace.display_name, workspace.id`,
          [authUserId],
        );
        const installationIds = [
          ...new Set(installations.rows.map((row) => row.installation_id)),
        ];
        if (installationIds.length === 0) return { installations: [] };
        const workItems = await transaction.query<BootstrapWorkRow>(
          `select work.installation_id, work.workspace_id, work.id, work.title, work.requested_outcome,
                  work.acceptance_criteria, work.state, work.priority,
                  work.parent_work_id,
                  coalesce(person.display_name, worker.name) as custodian_name,
                  case
                    when work.custodian_person_id is not null then 'person'
                    when work.custodian_worker_id is not null then 'worker'
                    else null
                  end as custodian_kind,
                  work.updated_at
             from public.work work
             left join public.people person
               on person.installation_id = work.installation_id
              and person.id = work.custodian_person_id
             left join public.workers worker
               on worker.installation_id = work.installation_id
              and worker.workspace_id = work.workspace_id
              and worker.id = work.custodian_worker_id
            where work.installation_id = any($1::uuid[])
            order by work.priority desc, work.updated_at desc, work.id`,
          [installationIds],
        );
        const bindings = await transaction.query<BootstrapBindingRow>(
          `select work.installation_id, work.workspace_id, work.id as work_id, work.title as work_title,
                worker.id as worker_id, worker.name as worker_name,
                role.id as role_id, role.name as role_name
           from public.work work
           join public.workers worker on worker.installation_id = work.installation_id
             and worker.workspace_id = work.workspace_id
           join public.worker_role_assignments assignment
             on assignment.installation_id = worker.installation_id
            and assignment.workspace_id = worker.workspace_id
            and assignment.worker_id = worker.id
           join public.roles role
             on role.installation_id = assignment.installation_id
            and role.workspace_id = assignment.workspace_id
            and role.id = assignment.role_id
           join public.capability_grants grant_row
             on grant_row.installation_id = worker.installation_id
            and grant_row.workspace_id = worker.workspace_id
            and grant_row.principal_kind = 'worker' and grant_row.worker_id = worker.id
            and grant_row.capability = 'executive.propose' and grant_row.mode = 'recommend'
            and (grant_row.work_id is null or grant_row.work_id = work.id)
            and (grant_row.expires_at is null or grant_row.expires_at > now())
           join public.policies policy
             on policy.installation_id = grant_row.installation_id
            and policy.workspace_id = grant_row.workspace_id
            and policy.id = grant_row.policy_id
          where work.installation_id = any($1::uuid[])
            and work.state in ('proposed', 'ready', 'review')
            and worker.provider = $2 and worker.model = $3
            and policy.definition ->> 'protocol' is distinct from $4
            and not exists (
              select 1 from public.capability_grant_revocations revocation
               where revocation.installation_id = grant_row.installation_id
                 and revocation.workspace_id = grant_row.workspace_id
                 and revocation.grant_id = grant_row.id
            )
          order by work.priority desc, work.created_at, worker.name, role.name`,
          [
            installationIds,
            this.provider,
            this.model,
            executiveCouncilProtocol,
          ],
        );
        const evidence = await transaction.query<BootstrapEvidenceRow>(
          `select installation_id, workspace_id, work_id, id, summary, source_uri, classification
           from public.records
          where installation_id = any($1::uuid[]) and kind = 'evidence'
          order by created_at desc
          limit 200`,
          [installationIds],
        );
        return {
          installations: [
            ...new Set(installations.rows.map((row) => row.installation_id)),
          ].map((installationId) => {
            const installation = installations.rows.find(
              (row) => row.installation_id === installationId,
            )!;
            return {
              id: installation.installation_id,
              slug: installation.installation_slug,
              displayName: installation.installation_display_name,
              workspaces: installations.rows
                .filter(
                  (workspace) => workspace.installation_id === installationId,
                )
                .map((workspace) => ({
                  id: workspace.workspace_id,
                  slug: workspace.workspace_slug,
                  displayName: workspace.workspace_display_name,
                  realm: workspace.workspace_realm,
                  personKind: workspace.person_kind,
                  workItems: workItems.rows
                    .filter(
                      (work) =>
                        work.installation_id === installationId &&
                        work.workspace_id === workspace.workspace_id,
                    )
                    .map((work) => ({
                      id: work.id,
                      title: work.title,
                      requestedOutcome: work.requested_outcome,
                      acceptanceCriteria: Array.isArray(
                        work.acceptance_criteria,
                      )
                        ? work.acceptance_criteria.filter(
                            (criterion): criterion is string =>
                              typeof criterion === "string",
                          )
                        : [],
                      state: work.state,
                      priority: work.priority,
                      parentWorkId: work.parent_work_id,
                      custodianName: work.custodian_name,
                      custodianKind: work.custodian_kind,
                      updatedAt:
                        work.updated_at instanceof Date
                          ? work.updated_at.toISOString()
                          : work.updated_at,
                    })),
                  proposalBindings: bindings.rows
                    .filter(
                      (binding) =>
                        binding.installation_id === installationId &&
                        binding.workspace_id === workspace.workspace_id,
                    )
                    .map((binding) => ({
                      workId: binding.work_id,
                      workTitle: binding.work_title,
                      workerId: binding.worker_id,
                      workerName: binding.worker_name,
                      roleId: binding.role_id,
                      roleName: binding.role_name,
                      evidence: evidence.rows
                        .filter(
                          (record) =>
                            record.installation_id === installationId &&
                            record.workspace_id === workspace.workspace_id &&
                            (record.work_id === null ||
                              record.work_id === binding.work_id),
                        )
                        .map((record) => ({
                          id: record.id,
                          summary: record.summary,
                          classification: record.classification,
                        })),
                    }))
                    .filter((binding) => binding.evidence.length > 0),
                })),
            };
          }),
        };
      },
    );
  }

  async resolveProposal(
    input: ProposalInput,
    requester: PersonContext,
  ): Promise<ExecutiveWorkerJobRequest> {
    if (
      requester.installationId !== input.installationId ||
      requester.workspaceId !== input.workspaceId
    ) {
      throw new ExecutiveRequestResolutionError(
        "Requester context cannot cross workspaces",
      );
    }
    const resolution = await this.database.asPerson(
      requester,
      async (transaction) => {
        const binding = await transaction.query<BindingRow>(
          `select work.id as work_id, worker.id as worker_id, role.id as role_id,
                role.name as role_name, role.version as role_version,
                role.skill_markdown, role.content_sha256,
                workspace.realm as workspace_realm
           from public.work work
           join public.workspaces workspace
             on workspace.installation_id = work.installation_id
            and workspace.id = work.workspace_id
           join public.workers worker
             on worker.installation_id = work.installation_id
            and worker.workspace_id = work.workspace_id and worker.id = $4
           join public.worker_role_assignments assignment
             on assignment.installation_id = worker.installation_id
            and assignment.workspace_id = worker.workspace_id
            and assignment.worker_id = worker.id
           join public.roles role
             on role.installation_id = assignment.installation_id
            and role.workspace_id = assignment.workspace_id
            and role.id = assignment.role_id and role.id = $5
           join public.capability_grants grant_row
             on grant_row.installation_id = worker.installation_id
            and grant_row.workspace_id = worker.workspace_id
            and grant_row.principal_kind = 'worker'
            and grant_row.worker_id = worker.id
            and grant_row.capability = 'executive.propose'
            and grant_row.mode = 'recommend'
            and (grant_row.work_id is null or grant_row.work_id = work.id)
            and (grant_row.expires_at is null or grant_row.expires_at > now())
           join public.policies policy
             on policy.installation_id = grant_row.installation_id
            and policy.workspace_id = grant_row.workspace_id
            and policy.id = grant_row.policy_id
          where work.installation_id = $1 and work.workspace_id = $2 and work.id = $3
            and work.state in ('proposed', 'ready', 'review')
            and worker.provider = $6 and worker.model = $7
            and policy.definition ->> 'protocol' is distinct from $8
            and not exists (
              select 1 from public.capability_grant_revocations revocation
               where revocation.installation_id = grant_row.installation_id
                 and revocation.workspace_id = grant_row.workspace_id
                 and revocation.grant_id = grant_row.id
            )`,
          [
            input.installationId,
            input.workspaceId,
            input.workId,
            input.workerId,
            input.roleId,
            this.provider,
            this.model,
            executiveCouncilProtocol,
          ],
        );
        const row = binding.rows[0];
        if (!row) {
          throw new ExecutiveRequestResolutionError(
            "Work, assigned role, configured worker, or executive.propose capability is missing or inapplicable",
          );
        }
        const workspaceRealm = installationRealmSchema.safeParse(
          row.workspace_realm,
        );
        if (!workspaceRealm.success) {
          throw new ExecutiveRequestResolutionError(
            "Workspace has no valid authoritative realm",
          );
        }
        const evidence = await transaction.query<EvidenceRow>(
          `select id, summary, source_uri, classification
           from public.records
          where installation_id = $1 and workspace_id = $2
            and kind = 'evidence' and id = any($3::uuid[])
          order by id`,
          [input.installationId, input.workspaceId, input.evidenceRecordIds],
        );
        if (evidence.rows.length !== new Set(input.evidenceRecordIds).size) {
          throw new ExecutiveRequestResolutionError(
            "One or more evidence records are missing or belong to another workspace",
          );
        }
        const memoryBankBindings =
          await transaction.query<MemoryBankBindingRow>(
            `select installation_id, workspace_id, installation_realm, external_bank_id
               from public.memory_banks
              where installation_id = $1
                and workspace_id = $2
                and installation_realm = $3::public.installation_realm
                and adapter = 'hindsight'`,
            [input.installationId, input.workspaceId, workspaceRealm.data],
          );
        return {
          workspaceRealm: workspaceRealm.data,
          memoryBankBindings: memoryBankBindings.rows,
          request: {
            installationId: input.installationId,
            workspaceId: input.workspaceId,
            workId: row.work_id,
            workerId: row.worker_id,
            role: {
              roleId: row.role_id,
              name: row.role_name,
              version: row.role_version,
              contentSha256: row.content_sha256,
              skillMarkdown: row.skill_markdown,
            },
            objective: input.objective,
            evidence: evidence.rows.map((item) => ({
              recordId: item.id,
              summary: item.summary,
              sourceUri: item.source_uri,
              classification: item.classification,
            })),
            background: input.background,
          },
        };
      },
    );
    const bank = workspaceHindsightBank(
      input.installationId,
      input.workspaceId,
      resolution.workspaceRealm,
    );
    let derivedContext: RetrievedContext[] = [];
    if (resolution.memoryBankBindings.length > 0) {
      const memoryBankBinding = resolution.memoryBankBindings[0];
      const bindingMatches =
        resolution.memoryBankBindings.length === 1 &&
        memoryBankBinding?.installation_id === input.installationId &&
        memoryBankBinding.workspace_id === input.workspaceId &&
        memoryBankBinding.installation_realm === resolution.workspaceRealm &&
        memoryBankBinding.external_bank_id === bank.id;
      if (!bindingMatches) {
        this.onMemoryWarning(
          new ExecutiveRequestResolutionError(
            "PostgreSQL memory bank binding does not match the selected workspace",
          ),
        );
      } else {
        try {
          const recalled = await this.memory.retrieve(bank, input.objective);
          derivedContext = await this.#resolveDerivedContext(
            input.installationId,
            input.workspaceId,
            resolution.workspaceRealm,
            requester,
            recalled,
          );
        } catch (error) {
          this.onMemoryWarning(error);
        }
      }
    }
    return {
      ...resolution.request,
      derivedContext,
    };
  }

  async #resolveDerivedContext(
    installationId: string,
    workspaceId: string,
    workspaceRealm: InstallationRealm,
    requester: PersonContext,
    recalled: HindsightMemory[],
  ): Promise<RetrievedContext[]> {
    const candidates = recalled.flatMap((item) => {
      const citations = sourceCitationSchema.array().safeParse(item.citations);
      if (
        !citations.success ||
        citations.data.length === 0 ||
        item.invalidatedAt !== null ||
        !sameStringSet(
          item.sourceRevisionIds,
          citations.data.map((citation) => citation.sourceRevisionId),
        )
      ) {
        return [];
      }
      return [{ item, citations: citations.data }];
    });
    const sourceRevisionIds = [
      ...new Set(candidates.flatMap(({ item }) => item.sourceRevisionIds)),
    ];
    if (sourceRevisionIds.length === 0) return [];

    const sourceRows = await this.database.asPerson(
      requester,
      async (transaction) =>
        transaction.query<MemorySourceRow>(
          `select revision.id as source_revision_id, revision.classification,
                  citation.source_uri, citation.revision_hash, citation.locator
             from public.transcript_revisions revision
             join public.memory_candidates candidate
               on candidate.installation_id = revision.installation_id
              and candidate.workspace_id = revision.workspace_id
              and candidate.installation_realm = revision.installation_realm
              and candidate.source_revision_id = revision.id
              and candidate.admission_state = 'admitted'
              and candidate.bank_id is not null
             join public.source_citations citation
               on citation.installation_id = revision.installation_id
              and citation.workspace_id = revision.workspace_id
              and citation.installation_realm = revision.installation_realm
              and citation.transcript_revision_id = revision.id
            where revision.installation_id = $1
              and revision.workspace_id = $2
              and revision.installation_realm = $3::public.installation_realm
              and revision.id = any($4::uuid[])
              and revision.deleted_at is null
              and revision.boundary = $5::public.source_boundary
              and revision.admission_state = 'admitted'
              and not exists (
                select 1 from public.transcript_revisions successor
                 where successor.installation_id = revision.installation_id
                   and successor.workspace_id = revision.workspace_id
                   and successor.installation_realm = revision.installation_realm
                   and successor.supersedes_revision_id = revision.id
              )
            order by revision.id, citation.locator`,
          [
            installationId,
            workspaceId,
            workspaceRealm,
            sourceRevisionIds,
            workspaceRealm,
          ],
        ),
    );
    const rowsBySource = new Map<string, MemorySourceRow[]>();
    for (const row of sourceRows.rows) {
      const rows = rowsBySource.get(row.source_revision_id) ?? [];
      rows.push(row);
      rowsBySource.set(row.source_revision_id, rows);
    }

    return candidates.flatMap(({ item, citations }) => {
      const classifications = item.sourceRevisionIds.flatMap(
        (sourceRevisionId) => {
          const rows = rowsBySource.get(sourceRevisionId);
          if (!rows || rows.length === 0) return [];
          const classification = dataClassificationSchema.safeParse(
            rows[0]?.classification,
          );
          if (
            !classification.success ||
            rows.some((row) => row.classification !== classification.data)
          ) {
            return [];
          }
          return [classification.data];
        },
      );
      if (classifications.length !== item.sourceRevisionIds.length) return [];
      const authoritativeCitations = new Set(
        item.sourceRevisionIds.flatMap((sourceRevisionId) =>
          (rowsBySource.get(sourceRevisionId) ?? []).map(citationKey),
        ),
      );
      const recalledCitations = new Set(citations.map(citationKey));
      if (
        recalledCitations.size !== authoritativeCitations.size ||
        [...recalledCitations].some(
          (citation) => !authoritativeCitations.has(citation),
        )
      ) {
        return [];
      }
      const parsed = retrievedContextSchema.safeParse({
        text: item.text,
        trust: "untrusted",
        derived: true,
        classification: deriveDataClassification(classifications),
        citations,
      });
      return parsed.success ? [parsed.data] : [];
    });
  }

  async resolveAuthority(
    input: {
      installationId: string;
      workspaceId: string;
      capabilityGrantId: string;
      approvalRecordId: string;
    },
    requester: PersonContext,
  ): Promise<ExecutionAuthority> {
    if (
      requester.installationId !== input.installationId ||
      requester.workspaceId !== input.workspaceId
    ) {
      throw new ExecutiveRequestResolutionError(
        "Requester context cannot cross workspaces",
      );
    }
    return this.database.asPerson(requester, async (transaction) => {
      const result = await transaction.query<GrantRow>(
        `select grant_row.policy_id, grant_row.worker_id, grant_row.capability, grant_row.mode
           from public.capability_grants grant_row
          where grant_row.installation_id = $1 and grant_row.workspace_id = $2
            and grant_row.id = $3
            and grant_row.principal_kind = 'worker'
            and (grant_row.expires_at is null or grant_row.expires_at > now())
            and not exists (
              select 1 from public.capability_grant_revocations revocation
               where revocation.installation_id = grant_row.installation_id
                 and revocation.workspace_id = grant_row.workspace_id
                 and revocation.grant_id = grant_row.id
            )`,
        [input.installationId, input.workspaceId, input.capabilityGrantId],
      );
      const row = result.rows[0];
      if (!row)
        throw new ExecutiveRequestResolutionError(
          "Capability grant is missing, expired, revoked, or belongs to another workspace",
        );
      return {
        policyId: row.policy_id,
        capabilityGrantId: input.capabilityGrantId,
        approvalRecordId: input.approvalRecordId,
        executorWorkerId: row.worker_id,
        capability: row.capability,
        mode: row.mode,
      };
    });
  }
}

function sameStringSet(left: string[], right: string[]): boolean {
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  return (
    leftSet.size === rightSet.size &&
    [...leftSet].every((value) => rightSet.has(value))
  );
}

function citationKey(citation: SourceCitation | MemorySourceRow): string {
  return JSON.stringify([
    "sourceRevisionId" in citation
      ? citation.sourceRevisionId
      : citation.source_revision_id,
    "sourceUri" in citation ? citation.sourceUri : citation.source_uri,
    "revisionHash" in citation ? citation.revisionHash : citation.revision_hash,
    citation.locator,
  ]);
}

const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function parseProposalInput(value: unknown): ProposalInput {
  if (!value || typeof value !== "object")
    throw new ExecutiveRequestInputError("Proposal request must be an object");
  const input = value as Record<string, unknown>;
  for (const forbidden of [
    "role",
    "skillMarkdown",
    "evidence",
    "authUserId",
    "auth_user_id",
    "userId",
  ]) {
    if (forbidden in input)
      throw new ExecutiveRequestInputError(
        `${forbidden} is server-resolved and cannot be supplied`,
      );
  }
  for (const key of [
    "installationId",
    "workspaceId",
    "workId",
    "workerId",
    "roleId",
  ] as const) {
    if (typeof input[key] !== "string" || !uuid.test(input[key]))
      throw new ExecutiveRequestInputError(
        `${key} must be a lowercase canonical UUID`,
      );
  }
  if (typeof input.objective !== "string" || !input.objective.trim())
    throw new ExecutiveRequestInputError("objective is required");
  if (
    !Array.isArray(input.evidenceRecordIds) ||
    input.evidenceRecordIds.length === 0 ||
    !input.evidenceRecordIds.every(
      (id) => typeof id === "string" && uuid.test(id),
    )
  ) {
    throw new ExecutiveRequestInputError(
      "evidenceRecordIds must contain lowercase canonical UUIDs",
    );
  }
  if (input.background !== undefined && typeof input.background !== "boolean")
    throw new ExecutiveRequestInputError("background must be boolean");
  return {
    installationId: input.installationId as string,
    workspaceId: input.workspaceId as string,
    workId: input.workId as string,
    workerId: input.workerId as string,
    roleId: input.roleId as string,
    objective: input.objective.trim(),
    evidenceRecordIds: input.evidenceRecordIds as string[],
    background: input.background ?? (false as boolean),
  };
}
