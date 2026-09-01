# Workspace compiled core-surface selection

This operator selects which interfaces already compiled into the deployed Vorton web release appear in one workspace. It is a transitional control-plane operation, not a module system.

The compiled registry owns each interface ID, label, contract version, and presentation variant. An operator may select interface IDs, choose their navigation order, and choose the default interface. The operator cannot inject labels or presentation policy.

The current registry contains seven compiled interfaces: Command Bridge, Opportunities, Goals, Tasks, Tools, Factory, and Admin.

This workflow does not admit a module, resolve or load an artifact, start a frontend or backend runtime, migrate module data, grant private-consumer authority, or change infrastructure. Installation-owned and independently distributed modules require a separate release-bound admission and loading architecture.

## Authority model

The workflow has four modes:

1. `--plan` reads the current projection and target preferences from local JSON files. It emits one deterministic `vorton.select-workspace-core-surface.v1` plan without making a network request.
2. `--approve` submits the exact plan transition. PostgreSQL requires live owner membership, recent AAL2, governed Work, Policy, the exact capability grant, the current projection, and the current selection receipt.
3. `--apply` atomically consumes that approval once, replaces the compiled projection, selects the default interface, and advances the receipt lineage.
4. `--verify` validates the exact application receipt, then requires runtime bootstrap to expose both the planned projection and that receipt ID and hash as the current PostgreSQL head.

The approval receipt records no effects. The application receipt records the selection. They are separate immutable documents. Exact replay returns the same application receipt. A conflicting replay fails closed.

Roles grant no authority. One workspace cannot lend authority to another.

## Deployment gate

Do not deploy the selection API or the web client over an installation that still contains historical unreceipted or product-specific core-surface rows.

Historical `freed-read-only` rows are preserved byte for byte by the migration. New or changed rows accept only the generic registry vocabulary. Existing rows require a separate receipt-bound installation upgrade and exact-preimage reconciliation before this API becomes active. A release preflight proving that no such rows exist is also sufficient.

The safe order is:

1. Prove zero incompatible historical rows, or complete the governed reconciliation upgrade.
2. Deploy the database migration.
3. Deploy the API.
4. Plan, approve, and apply each workspace selection.
5. Verify the exact projection and exact lineage head through runtime bootstrap.
6. Deploy the web client that consumes the selected projection.

The migration is deliberately not advertised as backward compatible. Theology has original sin; databases have legacy rows.

## Input files

The current projection is the exact surface currently stored for the workspace:

```json
{
  "defaultModuleId": "command",
  "modules": [
    {
      "id": "command",
      "contractVersion": "v1",
      "label": "Command Bridge",
      "navigationOrder": 10,
      "presentationVariant": "standard"
    }
  ]
}
```

Target preferences contain only compiled interface IDs, navigation order, and the default selection:

```json
{
  "defaultCoreSurfaceId": "command",
  "coreSurfaces": [
    { "id": "command", "navigationOrder": 10 },
    { "id": "factory", "navigationOrder": 20 }
  ]
}
```

Vorton derives the exact target projection from the pinned compiled-registry digest. Duplicate IDs or navigation positions fail closed. An unrecognized interface ID fails closed.

## Plan

The values below are synthetic placeholders.

```sh
export VORTON_CORE_SURFACE_SELECTION_INSTALLATION_ID=10000000-0000-4000-8000-000000000001
export VORTON_CORE_SURFACE_SELECTION_WORKSPACE_ID=10000000-0000-4000-8000-000000000002
export VORTON_CORE_SURFACE_SELECTION_APPROVAL_ID=10000000-0000-4000-8000-000000000003
export VORTON_CORE_SURFACE_SELECTION_WORK_ID=10000000-0000-4000-8000-000000000004
export VORTON_CORE_SURFACE_SELECTION_CAPABILITY_GRANT_ID=10000000-0000-4000-8000-000000000005
export VORTON_CORE_SURFACE_SELECTION_EXPIRES_AT=2026-09-01T18:00:00.000Z
export VORTON_CORE_SURFACE_SELECTION_CURRENT_SURFACE_PATH=/secure/operator/current-surface.json
export VORTON_CORE_SURFACE_SELECTION_TARGET_PREFERENCES_PATH=/secure/operator/target-preferences.json
export VORTON_CORE_SURFACE_SELECTION_PREDECESSOR_RECEIPT_ID=10000000-0000-4000-8000-000000000006
export VORTON_CORE_SURFACE_SELECTION_PREDECESSOR_RECEIPT_SHA256=sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa

npm run core-surface:select:plan > /secure/operator/selection-plan.json
```

Omit both predecessor variables only for genuine empty genesis. A previously selected workspace still requires its current predecessor receipt even if its visible projection later becomes empty.

Review the complete plan and canonical plan hash before requesting authority.

## Approve

Use a current human session after recent AAL2 step-up authentication:

```sh
export VORTON_CORE_SURFACE_SELECTION_API_URL=https://api.example.invalid
export VORTON_CORE_SURFACE_SELECTION_PLAN_PATH=/secure/operator/selection-plan.json
read -r -s 'VORTON_CORE_SURFACE_SELECTION_BEARER_TOKEN?Current session token: '
export VORTON_CORE_SURFACE_SELECTION_BEARER_TOKEN

npm run core-surface:select:approve > /secure/operator/selection-approval.json
```

Do not place the token in a plan, preference file, shell history, issue, log, or repository. The operator never prints it. HTTP failures expose only the operation and status code.

## Apply

Choose a fresh receipt UUID and submit the reviewed approval:

```sh
export VORTON_CORE_SURFACE_SELECTION_APPROVAL_PATH=/secure/operator/selection-approval.json
export VORTON_CORE_SURFACE_SELECTION_RECEIPT_ID=10000000-0000-4000-8000-000000000007

npm run core-surface:select:apply > /secure/operator/selection-receipt.json
```

Application fails closed if the projection, predecessor receipt, Work, Policy, capability grant, membership, or AAL2 authority changed after approval.

## Verify

Verification consumes the exact reviewed approval and application receipt:

```sh
export VORTON_CORE_SURFACE_SELECTION_RECEIPT_PATH=/secure/operator/selection-receipt.json

npm run core-surface:select:verify > /secure/operator/selection-verification.json
```

Verification succeeds only when runtime bootstrap exposes:

- the exact installation and workspace;
- `coreSurfaceState` equal to `selected`;
- the exact target projection and digest;
- the exact application receipt ID and hash as the current selection head.

Matching projection bytes under a later receipt do not verify an older plan.

## Rollback

Rollback is another governed selection. Build new target preferences for the prior compiled projection, use the current receipt as the predecessor, choose a new approval ID, and repeat all four modes. There is no ungated rollback command.
