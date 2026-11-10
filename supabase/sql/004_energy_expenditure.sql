-- TRANA: wearable energy-expenditure samples for calorie calibration.
--
-- Apply together with 001_schema.sql + 002_rls.sql + 003_activity_tracking.sql
-- on a fresh database, e.g.:
--   psql "$SUPABASE_DB_URL" -1 -f supabase/sql/001_schema.sql -f supabase/sql/002_rls.sql -f supabase/sql/003_activity_tracking.sql -f supabase/sql/004_energy_expenditure.sql
--
-- Do not apply against an existing Laravel database; run `php artisan migrate`
-- there instead.

-- One row per device-reported session: what the watch measured for calories,
-- kept so TRANA can calibrate its MET estimate against real device data.
create table public.energy_expenditure (
    id bigserial primary key,
    user_id bigint not null,
    device_type varchar(32) not null,
    activity_type varchar(16) not null,
    distance_km numeric(8, 3) not null,
    duration_min numeric(8, 2) not null,
    avg_heart_rate smallint,             -- bpm, device-reported
    weight_kg numeric(5, 2),             -- body mass when the session was recorded
    measured_calories integer not null,  -- what the device reported
    recorded_at timestamp(0) with time zone not null,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    constraint energy_expenditure_user_id_foreign
        foreign key (user_id) references public.users (id) on delete cascade
);
-- Re-importing the same device session updates the row instead of duplicating it.
create unique index energy_expenditure_user_id_device_type_recorded_at_unique
    on public.energy_expenditure (user_id, device_type, recorded_at);
create index energy_expenditure_user_id_activity_type_index
    on public.energy_expenditure (user_id, activity_type);

-- Row-level security: Laravel (Sanctum) is the only access path; Supabase
-- Data API roles get nothing on this table, matching 002_rls.sql.
do $$
declare
    relation_name text;
begin
    foreach relation_name in array array[
        'energy_expenditure'
    ] loop
        execute format('alter table public.%I enable row level security', relation_name);
        execute format('revoke all privileges on table public.%I from public', relation_name);
        for role_name in select rolname from pg_roles where rolname in ('anon', 'authenticated') loop
            execute format('revoke all privileges on table public.%I from %I', relation_name, role_name);
        end loop;
    end loop;
end $$;

revoke all privileges on sequence public.energy_expenditure_id_seq from public;

insert into public.migrations (migration, batch) values
    ('2026_11_10_000000_create_energy_expenditure_table', 3);
