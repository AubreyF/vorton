-- Bind every new or changed external memory-bank identity to its workspace.
-- Existing noncanonical rows remain explicitly unresolved until a separately
-- authorized migration assigns their workspace identity. Nothing is inferred.

begin;

alter table public.memory_banks
  add constraint memory_banks_external_bank_workspace_identity check (
    workspace_id is not null
    and external_bank_id =
      installation_realm::text || ':' || installation_id::text || ':'
      || workspace_id::text || ':lineage-v2'
  ) not valid;

comment on constraint memory_banks_external_bank_workspace_identity
  on public.memory_banks is
  'NOT VALID preserves explicitly unresolved legacy rows without rewriting them. PostgreSQL still requires realm:installation UUID:workspace UUID:lineage-v2 for every new or changed row.';

commit;
