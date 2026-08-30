# Executive workflows

The executive layer helps a person or organization notice evidence, develop options, make decisions, authorize Work, and compare outcomes with intent. It is not a fixed collection of chatbot characters.

## Roles and workers

An executive role is a versioned `SKILL.md` file. It teaches a worker how to act as a strategic reviewer, product lead, marketing lead, financial analyst, security reviewer, or another role. Any compatible worker may load it for a bounded assignment.

The role does not create an identity and does not grant authority. A worker receives authority only through an explicit capability grant, applicable Policy, and assigned Work. This keeps the system flexible without pretending a prompt is a constitution.

## Decision flow

```text
Evidence
  -> Proposal
  -> Review
  -> Decision
  -> Approval when required
  -> Work
  -> Receipt
  -> Outcome
  -> Candidate learning
```

Each stage is a Record with provenance. A later Record may supersede an earlier decision. Editing history in place is forbidden.

Executive workers may recommend any action that the installation can describe, including software changes, research, finance analysis, marketing campaigns, hiring, communications, tool creation, policy changes, and new modules. Recommendation breadth is not execution authority. Each external effect routes through the relevant capability, Policy, approval, and worker adapter.

## Initial executive copilot

The first FreedOS executive copilot supports:

- evidence review and source citations;
- proposals with alternatives, risks, expected outcomes, and confidence;
- decisions classified as advisory, delegated, owner-required, policy-authorized, prohibited, or one-way;
- explicit owner approvals;
- promotion of an approved proposal into Work;
- worker assignment and status;
- outcome review against the approved intent; and
- candidate learnings that remain quarantined until promoted.

The default private-pilot route uses the Codex CLI with owner-delegated ChatGPT subscription authentication. Provider identity, configured model, billing boundary, host, and capabilities remain visible on every run. The OpenAI Responses API remains an optional usage-billed adapter for installations that select it explicitly. Neither provider becomes a new authority source.

## Wave 2 implementation

`@vorton/executive` coordinates the append-only path. It accepts Evidence, records a structured Proposal from a worker, requires a human Review and Decision, records explicit Approval, and creates governed Work only after the approval, Policy, capability grant, capability, and mode agree. Receipts cite the accepted Work. Outcomes compare the receipt with the approved intent. Learnings enter quarantine as candidates and gain no authority from repetition.

`@vorton/workers` defines the provider boundary. The deterministic fake adapter covers tests without credentials. The subscription adapter invokes a pinned Codex CLI with an explicit model and reasoning effort, a read-only sandbox, no approvals, ephemeral sessions, and every tool surface disabled. It ignores user configuration and rules, passes only `CODEX_HOME` and `PATH`, and serializes all work that shares an authentication cache. Evidence or derived context above the configured classification ceiling fails before invocation. Background and retrieval operations are unavailable.

The worker seeds managed ChatGPT authentication once from a secret into a dedicated encrypted Fly volume. Codex refreshes that cache in place. The original seed never overwrites a refreshed cache. This is an owner-delegated private automation boundary, not an Vorton worker identity and not a generic credential for customer installations.

The optional OpenAI adapter uses the Responses API and Structured Outputs. It requires API billing and does not consume a ChatGPT subscription. `VORTON_OPENAI_STORE_RESPONSES` defaults to `false`; background retrieval requires explicit response storage.

Both adapters expose no database client or external executor. Their output can become a Proposal record. It cannot create a Decision, Approval, capability grant, Work, Receipt, Outcome, or admitted learning. The subscription automation pattern follows the official [Codex authentication guidance](https://learn.chatgpt.com/docs/auth/ci-cd-auth).

Synthetic role files live under `packages/executive/roles`. They define methods and review standards. Loading or assigning one changes competence instructions only.

## Completion evidence

An executive workflow is complete only when the system can trace:

1. the evidence that produced the proposal;
2. the role and worker that produced each recommendation;
3. the Policy that classified the decision;
4. the person or grant that supplied authority;
5. the exact Work accepted for execution;
6. the worker receipt and produced artifacts; and
7. the observed outcome and any superseding decision.
