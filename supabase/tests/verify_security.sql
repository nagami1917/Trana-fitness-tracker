-- Read-only checks for the Laravel/Sanctum Supabase deployment.
-- Run as the database owner, e.g. psql "$SUPABASE_DB_URL" -f this file.
do $$
declare
    relation_name text;
    sequence_name text;
    role_name text;
    privilege_name text;
begin
    foreach relation_name in array array[
        'migrations', 'users', 'sessions', 'cache', 'cache_locks', 'jobs',
        'failed_jobs', 'fitness_profiles', 'activities', 'predictions', 'goals',
        'personal_access_tokens', 'email_otp_challenges',
        -- Activity tracking, energy calibration and daily sessions.
        'activity_points', 'planned_routes', 'route_points',
        'energy_expenditure', 'daily_sessions', 'daily_session_foods'
    ] loop
        if not exists (
            select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relname = relation_name
              and c.relkind = 'r' and c.relrowsecurity
        ) then
            raise exception 'Missing table or RLS is disabled: %', relation_name;
        end if;
    end loop;

    foreach relation_name in array array[
        'user_profiles', 'planned_activities', 'nutritional_predictions',
        'activity_routes', 'user_goals', 'prediction_history',
        'v_athlete_pace', 'v_daily_totals', 'v_prediction_accuracy'
    ] loop
        if not exists (
            select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
            where n.nspname = 'public' and c.relname = relation_name
              and c.relkind = 'v' and c.reloptions @> array['security_invoker=true']
        ) then
            raise exception 'Missing security-invoker view: %', relation_name;
        end if;
    end loop;

    foreach role_name in array array['anon', 'authenticated'] loop
        foreach relation_name in array array[
            'migrations', 'users', 'sessions', 'cache', 'cache_locks', 'jobs',
            'failed_jobs', 'fitness_profiles', 'activities', 'predictions', 'goals',
            'personal_access_tokens', 'email_otp_challenges', 'user_profiles', 'planned_activities',
            'nutritional_predictions', 'activity_routes', 'user_goals',
            'prediction_history', 'v_athlete_pace', 'v_daily_totals', 'v_prediction_accuracy',
            'activity_points', 'planned_routes', 'route_points',
            'energy_expenditure', 'daily_sessions', 'daily_session_foods'
        ] loop
            foreach privilege_name in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE'] loop
                if has_table_privilege(role_name, format('public.%I', relation_name), privilege_name) then
                    raise exception '% has % on %', role_name, privilege_name, relation_name;
                end if;
            end loop;
            foreach privilege_name in array array['SELECT', 'INSERT', 'UPDATE', 'REFERENCES'] loop
                if has_any_column_privilege(role_name, format('public.%I', relation_name), privilege_name) then
                    raise exception '% has column % on %', role_name, privilege_name, relation_name;
                end if;
            end loop;
        end loop;

        foreach sequence_name in array array[
            'migrations_id_seq', 'users_id_seq', 'jobs_id_seq', 'failed_jobs_id_seq',
            'fitness_profiles_id_seq', 'activities_id_seq', 'predictions_id_seq',
            'goals_id_seq', 'personal_access_tokens_id_seq', 'email_otp_challenges_id_seq',
            'activity_points_id_seq', 'planned_routes_id_seq', 'route_points_id_seq',
            'energy_expenditure_id_seq', 'daily_sessions_id_seq', 'daily_session_foods_id_seq'
        ] loop
            foreach privilege_name in array array['USAGE', 'SELECT', 'UPDATE'] loop
                if has_sequence_privilege(role_name, format('public.%I', sequence_name), privilege_name) then
                    raise exception '% has % on sequence %', role_name, privilege_name, sequence_name;
                end if;
            end loop;
        end loop;
    end loop;

    if (select count(*) from public.migrations where migration in (
        '0001_01_01_000000_create_users_table',
        '0001_01_01_000001_create_cache_table',
        '0001_01_01_000002_create_jobs_table',
        '2026_01_01_000000_create_trana_tables',
        '2026_01_01_000001_create_personal_access_tokens_table',
        '2026_11_08_000001_create_spec_compatibility_views',
        '2026_11_08_000002_secure_supabase_data_api',
        '2026_11_08_000003_add_user_profile_spec_fields',
        '2026_11_08_110000_create_activity_points_table',
        '2026_11_08_110001_create_planned_routes_table',
        '2026_11_08_110002_create_route_points_table',
        '2026_11_08_110003_add_tracking_columns_to_activities_table',
        '2026_11_08_120000_create_energy_expenditure_table',
        '2026_11_08_130000_create_daily_sessions_table',
        '2026_11_08_130001_create_daily_session_foods_table',
        '2026_11_14_000001_create_email_otp_challenges_table',
        '2026_11_14_000002_secure_email_otp_challenges',
        '2026_11_14_000003_add_google_sub_to_users_table'
    )) <> 18 then
        raise exception 'Laravel migration records are incomplete — run php artisan migrate';
    end if;
end $$;
select 'TRANA RLS, views, role privileges and migration baseline verified' as status;
