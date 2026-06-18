revoke all privileges on table public.workspace_metric_definitions from anon;
revoke all privileges on table public.workspace_metric_definitions from authenticated;

revoke all privileges on table public.workspace_metric_definition_snapshots from anon;
revoke all privileges on table public.workspace_metric_definition_snapshots from authenticated;

grant select, insert, update, delete on table public.workspace_metric_definitions to service_role;
grant select, insert, update, delete on table public.workspace_metric_definition_snapshots to service_role;
