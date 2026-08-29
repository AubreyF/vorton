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

The initial worker route uses the OpenAI Responses API. Provider identity, configured model, billing boundary, host, and capabilities remain visible on every run. A future provider can implement the worker protocol without becoming a new authority source.

## Wave 2 implementation

`@aubos/executive` coordinates the append-only path. It accepts Evidence, records a structured Proposal from a worker, requires a human Review and Decision, records explicit Approval, and creates governed Work only after the approval, Policy, capability grant, capability, and mode agree. Receipts cite the accepted Work. Outcomes compare the receipt with the approved intent. Learnings enter quarantine as candidates and gain no authority from repetition.

`@aubos/workers` defines the provider boundary. The deterministic fake adapter covers tests without credentials. The OpenAI adapter uses the Responses API and Structured Outputs. `AUBOS_OPENAI_MODEL` is required. `AUBOS_OPENAI_STORE_RESPONSES` defaults to `false`. `AUBOS_OPENAI_CLASSIFICATION_CEILING` defaults to `internal`, and the adapter rejects Evidence above that ceiling. Background retrieval requires explicit response storage because AubOS does not retrieve stateless responses. Request metadata contains installation ID, Work ID, worker ID, role content hash, and role version. It contains no person, email, account, or role name.

The OpenAI adapter sends no tools and exposes no database client or external executor. Its output can become a Proposal record. It cannot create a Decision, Approval, capability grant, Work, Receipt, Outcome, or admitted learning. The provider request shape follows the official [Responses create API](https://developers.openai.com/api/reference/cli/resources/responses/methods/create).

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
