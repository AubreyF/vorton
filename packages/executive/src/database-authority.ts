import type { Database } from "@vorton/database";

import type {
  ExecutiveAuthorityVerification,
  ExecutiveAuthorityVerifier,
} from "./workflow.js";

interface AuthorityRow {
  grant_id: string;
}

/**
 * Verifies that the cited grant belongs to the cited Policy, names the executor,
 * matches the approved capability and mode, covers the analysis Work when scoped,
 * has not expired, and has not been revoked.
 */
export class DatabaseExecutiveAuthorityVerifier implements ExecutiveAuthorityVerifier {
  constructor(private readonly database: Database) {}

  async resolvePerson(input: {
    installationId: string;
    workspaceId: string;
    authUserId: string;
    requiredAuthority: "member" | "owner";
    operation: "review" | "decision" | "approval";
  }): Promise<string> {
    const result = await this.database.asPerson(
      {
        installationId: input.installationId,
        workspaceId: input.workspaceId,
        authUserId: input.authUserId,
      },
      (transaction) =>
        transaction.query<{ id: string }>(
          `select person.id
           from public.people person
           join public.workspace_memberships membership
             on membership.installation_id = person.installation_id
            and membership.person_id = person.id
          where person.installation_id = $1
            and membership.workspace_id = $2
            and person.auth_user_id = $3
            and ($4 = 'member' or membership.kind = 'owner')`,
          [
            input.installationId,
            input.workspaceId,
            input.authUserId,
            input.requiredAuthority,
          ],
        ),
    );
    const person = result.rows[0];
    if (!person) {
      throw new Error(
        `${input.requiredAuthority === "owner" ? "Owner" : "Member"} authority is required for executive ${input.operation}`,
      );
    }
    return person.id;
  }

  async assertApplicable(input: ExecutiveAuthorityVerification): Promise<void> {
    const result = await this.database.asPerson(
      input.requester,
      (transaction) =>
        transaction.query<AuthorityRow>(
          `select grant.id as grant_id
           from public.capability_grants grant
           join public.policies policy
             on policy.installation_id = grant.installation_id
            and policy.workspace_id = grant.workspace_id
            and policy.id = grant.policy_id
          where grant.installation_id = $1
            and grant.workspace_id = $2
            and grant.id = $3
            and policy.id = $4
            and grant.principal_kind = 'worker'
            and grant.worker_id = $5
            and grant.capability = $6
            and grant.mode = $7
            and (grant.work_id is null or grant.work_id = $8)
            and (grant.expires_at is null or grant.expires_at > now())
            and not exists (
              select 1
                from public.capability_grant_revocations revocation
               where revocation.installation_id = grant.installation_id
                 and revocation.workspace_id = grant.workspace_id
                 and revocation.grant_id = grant.id
            )`,
          [
            input.installationId,
            input.workspaceId,
            input.authority.capabilityGrantId,
            input.authority.policyId,
            input.authority.executorWorkerId,
            input.authority.capability,
            input.authority.mode,
            input.proposal.workId,
          ],
        ),
    );
    if (!result.rows[0]) {
      throw new Error(
        "Policy and capability grant are missing, expired, revoked, out of scope, or inapplicable",
      );
    }
  }
}
