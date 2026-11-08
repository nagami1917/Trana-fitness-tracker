-- ===========================================================================
-- TRANA — Row Level Security
-- ===========================================================================
-- Two supported deployment modes:
--
--  A. Laravel owns authentication (default in this repository).
--     Laravel connects with the Postgres superuser/service role, which
--     bypasses RLS. RLS is still enabled as defence-in-depth: if a leaked
--     anon key ever reaches a browser, it cannot read athlete data.
--
--  B. Supabase Auth (`auth.uid()`) is used directly by another client.
--     Uncomment the second block to let each authenticated user read only
--     their own rows. In that mode, mirror auth.users ids into public.users.
-- ===========================================================================

alter table public.users            enable row level security;
alter table public.fitness_profiles enable row level security;
alter table public.activities       enable row level security;
alter table public.predictions       enable row level security;
alter table public.goals            enable row level security;

-- No policies for the `anon` / `authenticated` roles in mode A: nothing is
-- reachable except through the Laravel API (which uses the service role).

-- --- Mode B (Supabase Auth) ------------------------------------------------
-- create policy "own profile" on public.fitness_profiles
--     for all to authenticated
--     using (user_id = auth.uid())
--     with check (user_id = auth.uid());
--
-- create policy "own activities" on public.activities
--     for all to authenticated
--     using (user_id = auth.uid())
--     with check (user_id = auth.uid());
--
-- create policy "own predictions" on public.predictions
--     for all to authenticated
--     using (user_id = auth.uid())
--     with check (user_id = auth.uid());
--
-- create policy "own goals" on public.goals
--     for all to authenticated
--     using (user_id = auth.uid())
--     with check (user_id = auth.uid());

-- Grants for the service role used by Laravel.
grant usage on schema public to service_role;
grant all privileges on all tables in schema public to service_role;
grant all privileges on all sequences in schema public to service_role;
