-- TRANA: energy expenditure table (wearable-measured, e.g. WEEE dataset).
--
-- Used to calibrate TRANA's MET-based calorie estimates against real sensor
-- data from heart rate and physiological devices.
--
-- Apply together with 001_schema.sql + 002_rls.sql on a fresh database, e.g.:
--   psql "$SUPABASE_DB_URL" -1 -f supabase/sql/001_schema.sql -f supabase/sql/002_rls.sql -f supabase/sql/004_energy_expenditure.sql
--
-- Do not apply against an existing Laravel database; run `php artisan migrate`
-- there instead.

-- Wearable-measured energy expenditure for calorie calibration.
create table public.energy_expenditure (
    id bigserial primary key,
    user_id bigint not null,
    device_type varchar(50) not null,           -- e.g. 'garmin', 'apple_watch', 'fitbit', 'polar'
    activity_type varchar(16) not null,
    distance_km numeric(8, 3) not null,
    duration_min numeric(8, 2) not null,
    avg_heart_rate smallint,                    -- beats per minute
    max_heart_rate smallint,                    -- beats per minute
    weight_kg numeric(5, 2) not null,
    height_cm numeric(5, 1),
    age smallint,
    sex varchar(16),
    measured_calories numeric(8, 2) not null,   -- wearable-measured energy expenditure
    trana_estimated_calories integer,           -- TRANA's MET estimate at time of import
    recorded_at timestamp(0) with time zone not null,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    constraint energy_expenditure_user_id_foreign
        foreign key (user_id) references public.users (id) on delete cascade
);
create index energy_expenditure_user_id_recorded_at_index
    on public.energy_expenditure (user_id, recorded_at);
create index energy_expenditure_user_id_index
    on public.energy_expenditure (user_id);

-- Row-level security: Laravel (Sanctum) is the only access path; Supabase
-- Data API roles get nothing on this table, matching 002_rls.sql.
do $$
declare
    relation_name text;
    role_name text;
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

-- Supabase grants the Data API roles USAGE on new sequences by default; take
-- it back so the browser roles cannot even touch the id generator.
do $$
declare
    sequence_name text;
    role_name text;
begin
    foreach sequence_name in array array[
        'energy_expenditure_id_seq'
    ] loop
        execute format('revoke all privileges on sequence public.%I from public', sequence_name);
        for role_name in select rolname from pg_roles where rolname in ('anon', 'authenticated') loop
            execute format('revoke all privileges on sequence public.%I from %I', sequence_name, role_name);
        end loop;
    end loop;
end $$;

insert into public.migrations (migration, batch) values
    ('2026_11_08_120000_create_energy_expenditure_table', 3);
