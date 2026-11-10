-- TRANA: activity tracking tables (live GPS mapping).
--
-- Apply together with 001_schema.sql + 002_rls.sql on a fresh database, e.g.:
--   psql "$SUPABASE_DB_URL" -1 -f supabase/sql/001_schema.sql -f supabase/sql/002_rls.sql -f supabase/sql/003_activity_tracking.sql
--
-- Do not apply against an existing Laravel database; run `php artisan migrate`
-- there instead.

-- Live GPS samples recorded while an activity is tracked.
create table public.activity_points (
    id bigserial primary key,
    activity_id bigint not null,
    latitude numeric(10, 7) not null,
    longitude numeric(11, 7) not null,
    altitude numeric(7, 2),            -- metres above sea level
    speed numeric(6, 2),               -- km/h, device-reported
    accuracy smallint,                 -- metres, device-reported
    timestamp timestamp(0) with time zone not null,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    constraint activity_points_activity_id_foreign
        foreign key (activity_id) references public.activities (id) on delete cascade
);
create index activity_points_activity_id_timestamp_index
    on public.activity_points (activity_id, timestamp);
create index activity_points_timestamp_index
    on public.activity_points (timestamp);

-- Routes an athlete plans ahead of a session (GeoJSON geometry).
create table public.planned_routes (
    id bigserial primary key,
    user_id bigint not null,
    name varchar(255) not null,
    distance_km numeric(8, 3) not null,
    estimated_duration_min numeric(8, 2) not null,
    elevation_gain_m integer not null default 0,
    route_geojson jsonb,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    constraint planned_routes_user_id_foreign
        foreign key (user_id) references public.users (id) on delete cascade
);
create index planned_routes_user_id_created_at_index
    on public.planned_routes (user_id, created_at);

-- Denormalised vertices of a planned route for fast map rendering.
create table public.route_points (
    id bigserial primary key,
    route_id bigint not null,
    latitude numeric(10, 7) not null,
    longitude numeric(11, 7) not null,
    altitude numeric(7, 2),
    sequence smallint not null,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    constraint route_points_route_id_foreign
        foreign key (route_id) references public.planned_routes (id) on delete cascade
);
create unique index route_points_route_id_sequence_index
    on public.route_points (route_id, sequence);
create index route_points_route_id_sequence_idx
    on public.route_points (route_id, sequence);

-- Extra tracking fields on activities (end time, pace, GeoJSON route).
alter table public.activities
    add column if not exists ended_at timestamp(0) with time zone,
    add column if not exists average_speed numeric(6, 2),
    add column if not exists average_pace numeric(6, 2),
    add column if not exists route_geojson jsonb;

-- Predictions may reference the activity they were generated from.
alter table public.predictions
    add column if not exists activity_id bigint,
    add constraint predictions_activity_id_foreign
        foreign key (activity_id) references public.activities (id) on delete set null;
create index if not exists predictions_activity_id_index
    on public.predictions (activity_id);

-- Row-level security: Laravel (Sanctum) is the only access path; Supabase
-- Data API roles get nothing on these tables, matching 002_rls.sql.
do $$
declare
    relation_name text;
    role_name text;
begin
    foreach relation_name in array array[
        'activity_points', 'planned_routes', 'route_points'
    ] loop
        execute format('alter table public.%I enable row level security', relation_name);
        execute format('revoke all privileges on table public.%I from public', relation_name);
        for role_name in select rolname from pg_roles where rolname in ('anon', 'authenticated') loop
            execute format('revoke all privileges on table public.%I from %I', relation_name, role_name);
        end loop;
    end loop;
end $$;

-- Supabase grants the Data API roles USAGE on new sequences by default; take
-- it back so the browser roles cannot even touch the id generators.
do $$
declare
    sequence_name text;
    role_name text;
begin
    foreach sequence_name in array array[
        'activity_points_id_seq', 'planned_routes_id_seq', 'route_points_id_seq'
    ] loop
        execute format('revoke all privileges on sequence public.%I from public', sequence_name);
        for role_name in select rolname from pg_roles where rolname in ('anon', 'authenticated') loop
            execute format('revoke all privileges on sequence public.%I from %I', sequence_name, role_name);
        end loop;
    end loop;
end $$;

insert into public.migrations (migration, batch) values
    ('2026_11_08_110000_create_activity_points_table', 2),
    ('2026_11_08_110001_create_planned_routes_table', 2),
    ('2026_11_08_110002_create_route_points_table', 2),
    ('2026_11_08_110003_add_tracking_columns_to_activities_table', 2);
