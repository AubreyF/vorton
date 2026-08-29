import type { Database } from "@aubos/database";

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

  async assertOwner(input: {
    installationId: string;
    personId: string;
    operation: "decision" | "approval";
  }): Promise<void> {
    const result = await this.database.asAdministrator((transaction) =>
      transaction.query<{ id: string }>(
        `select id
           from public.people
          where installation_id = $1 and id = $2 and kind = 'owner'`,
        [input.installationId, input.personId],
      ),
    );
    if (!result.rows[0]) {
      throw new Error(
        `Owner authority is required for executive ${input.operation}`,
      );
    }
  }

  async assertApplicable(input: ExecutiveAuthorityVerification): Promise<void> {
    const result = await this.database.asAdministrator((transaction) =>
      transaction.query<AuthorityRow>(
        `select grant.id as grant_id
           from public.capability_grants grant
           join public.policies policy
             on policy.installation_id = grant.installation_id
            and policy.id = grant.policy_id
          where grant.installation_id = $1
            and grant.id = $2
            and policy.id = $3
            and grant.principal_kind = 'worker'
            and grant.worker_id = $4
            and grant.capability = $5
            and grant.mode = $6
            and (grant.work_id is null or grant.work_id = $7)
            and (grant.expires_at is null or grant.expires_at > now())
            and not exists (
              select 1
                from public.capability_grant_revocations revocation
               where revocation.installation_id = grant.installation_id
                 and revocation.grant_id = grant.id
            )`,
        [
          input.installationId,
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
