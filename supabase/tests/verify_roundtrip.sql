-- Exercise the Laravel database owner's basic writes and views without leaving
-- data behind. The inner exception block rolls back its inserts and deletes;
-- explicit negative IDs avoid advancing application sequences.
do $$
begin
    begin
        insert into public.users (id, name, email, password, created_at, updated_at)
        values (-1, 'Schema smoke test', 'schema-smoke@invalid.test', 'not-a-real-password', now(), now());
        insert into public.fitness_profiles
            (id, user_id, weight_kg, birth_year, activity_experience, created_at, updated_at)
        values (-1, -1, 60, cast(extract(year from current_date) as integer) - 30, 5.5, now(), now());
        insert into public.goals (id, user_id, created_at, updated_at) values (-1, -1, now(), now());
        insert into public.activities (id, user_id, activity_type, distance_km, duration_min, started_at, created_at, updated_at)
        values (-1, -1, 'run', 5, 30, now(), now(), now());
        insert into public.predictions (id, user_id, activity_type, distance_km, duration_min, duration_low_min, duration_high_min, payload, created_at, updated_at)
        values (-1, -1, 'run', 5, 30, 25, 35, '{}'::jsonb, now(), now());
        insert into public.personal_access_tokens (id, tokenable_type, tokenable_id, name, token, created_at, updated_at)
        values (-1, 'App\Models\User', -1, 'smoke', repeat('a', 64), now(), now());
        insert into public.sessions (id, user_id, payload, last_activity) values ('trana-schema-smoke', -1, 'test', 0);
        insert into public.cache (key, value, expiration) values ('trana-schema-smoke', 'test', 0);
        if (select count(*) from public.user_profiles where user_id = -1) <> 1
            or (select count(*) from public.v_daily_totals where user_id = -1) <> 1 then
            raise exception 'Expected backend views are not readable';
        end if;
        -- Step 4: user_profiles must expose age, fitness_level and activity_experience.
        if not exists (
            select 1 from public.user_profiles
            where user_id = -1 and age = 30 and fitness_level = 1 and activity_experience = 5.5
        ) then
            raise exception 'user_profiles is missing the Step 4 spec fields';
        end if;
        delete from public.users where id = -1;
        if exists (select 1 from public.activities where user_id = -1)
            or exists (select 1 from public.predictions where user_id = -1) then
            raise exception 'User cascade did not work';
        end if;
        raise exception using errcode = 'T0001', message = 'Rollback smoke-test rows';
    exception when sqlstate 'T0001' then
        null;
    end;
end $$;
select 'Backend table, token, cache, view and cascade round-trip passed; test data rolled back' as status;
