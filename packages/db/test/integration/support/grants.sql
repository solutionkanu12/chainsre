-- Test-only: table-level privileges matching the real Supabase platform's
-- defaults, applied AFTER migrations so it covers every table that now
-- exists. RLS — not this grant — is the real authorization boundary; a role
-- needs both a table-level grant AND a matching RLS policy to actually read
-- or write a row. Run once, after 0001/0002/0003.

grant select, insert, update, delete on all tables in schema public to anon, authenticated;
grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to anon, authenticated, service_role;

grant select on auth.users to anon, authenticated, service_role;
