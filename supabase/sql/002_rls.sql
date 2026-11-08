-- TRANA uses Laravel/Sanctum, not Supabase Auth. Access is through the Laravel
-- database connection only; anon/authenticated Supabase Data API roles have no
-- access. Apply with 001_schema.sql in one transaction on a fresh database.
--
-- Views must also be protected: ordinary Postgres views run as their owner and
-- can bypass the underlying tables' RLS. Postgres 15+ security_invoker views
-- enforce the caller's permissions and RLS as a second layer of protection.

do $$
declare
    relation_name text;
    sequence_name text;
    role_name text;
begin
    foreach relation_name in array array[
        'migrations', 'users', 'sessions', 'cache', 'cache_locks', 'jobs',
        'failed_jobs', 'fitness_profiles', 'activities', 'predictions', 'goals',
        'personal_access_tokens'
    ] loop
        execute format('alter table public.%I enable row level security', relation_name);
    end loop;

    foreach relation_name in array array[
        'user_profiles', 'planned_activities', 'nutritional_predictions',
        'activity_routes', 'user_goals', 'prediction_history',
        'v_athlete_pace', 'v_daily_totals', 'v_prediction_accuracy'
    ] loop
        execute format('alter view public.%I set (security_invoker = true)', relation_name);
    end loop;

    foreach relation_name in array array[
        'migrations', 'users', 'sessions', 'cache', 'cache_locks', 'jobs',
        'failed_jobs', 'fitness_profiles', 'activities', 'predictions', 'goals',
        'personal_access_tokens', 'user_profiles', 'planned_activities',
        'nutritional_predictions', 'activity_routes', 'user_goals',
        'prediction_history', 'v_athlete_pace', 'v_daily_totals', 'v_prediction_accuracy'
    ] loop
        execute format('revoke all privileges on table public.%I from public', relation_name);
        for role_name in select rolname from pg_roles where rolname in ('anon', 'authenticated') loop
            execute format('revoke all privileges on table public.%I from %I', relation_name, role_name);
        end loop;
    end loop;

    foreach sequence_name in array array[
        'migrations_id_seq', 'users_id_seq', 'jobs_id_seq', 'failed_jobs_id_seq',
        'fitness_profiles_id_seq', 'activities_id_seq', 'predictions_id_seq',
        'goals_id_seq', 'personal_access_tokens_id_seq'
    ] loop
        execute format('revoke all privileges on sequence public.%I from public', sequence_name);
        for role_name in select rolname from pg_roles where rolname in ('anon', 'authenticated') loop
            execute format('revoke all privileges on sequence public.%I from %I', sequence_name, role_name);
        end loop;
    end loop;
end $$;

insert into public.migrations (migration, batch) values
    ('2026_11_08_000002_secure_supabase_data_api', 1);
