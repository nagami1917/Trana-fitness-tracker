-- TRANA / Laravel baseline for a NEW, EMPTY Supabase database.
--
-- This file and 002_rls.sql must be applied together in one transaction, e.g.:
--   psql "$SUPABASE_DB_URL" -1 -f supabase/sql/001_schema.sql -f supabase/sql/002_rls.sql
-- They create the same tables needed by the Laravel migrations and record those
-- migrations as applied. Do not run them against an existing Laravel database;
-- use `php artisan migrate` there instead. Never use migrate:fresh in production.

-- Laravel's migration repository. These entries are a baseline, not sample data.
create table public.migrations (
    id serial primary key,
    migration varchar(255) not null,
    batch integer not null
);

create table public.users (
    id bigserial primary key,
    name varchar(255) not null,
    email varchar(255) not null,
    email_verified_at timestamp(0) without time zone,
    password varchar(255) not null,
    remember_token varchar(100),
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    constraint users_email_unique unique (email)
);

create table public.sessions (
    id varchar(255) primary key,
    user_id bigint,
    ip_address varchar(45),
    user_agent text,
    payload text not null,
    last_activity integer not null
);
create index sessions_user_id_index on public.sessions (user_id);
create index sessions_last_activity_index on public.sessions (last_activity);

create table public.cache (
    key varchar(255) primary key,
    value text not null,
    expiration integer not null
);
create table public.cache_locks (
    key varchar(255) primary key,
    owner varchar(255) not null,
    expiration integer not null
);

create table public.jobs (
    id bigserial primary key,
    queue varchar(255) not null,
    payload text not null,
    attempts smallint not null,
    reserved_at integer,
    available_at integer not null,
    created_at integer not null
);
create index jobs_queue_index on public.jobs (queue);
create table public.failed_jobs (
    id bigserial primary key,
    uuid varchar(255) not null,
    connection text not null,
    queue text not null,
    payload text not null,
    exception text not null,
    failed_at timestamp(0) without time zone not null default current_timestamp,
    constraint failed_jobs_uuid_unique unique (uuid)
);

create table public.fitness_profiles (
    id bigserial primary key,
    user_id bigint not null,
    weight_kg numeric(5, 2) not null,
    height_cm numeric(5, 1),
    birth_year smallint,
    sex varchar(16) not null default 'other',
    sweat_profile varchar(16) not null default 'normal',
    experience_level smallint not null default 1,
    typical_temperature_c numeric(4, 1) not null default 26,
    city varchar(255),
    units varchar(10) not null default 'metric',
    onboarded_at timestamp(0) with time zone,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    constraint fitness_profiles_user_id_unique unique (user_id),
    constraint fitness_profiles_user_id_foreign foreign key (user_id) references public.users (id) on delete cascade
);

create table public.activities (
    id bigserial primary key,
    user_id bigint not null,
    activity_type varchar(16) not null,
    distance_km numeric(8, 3) not null,
    elevation_gain_m integer not null default 0,
    duration_min numeric(8, 2) not null,
    calories integer,
    avg_heart_rate smallint,
    started_at timestamp(0) with time zone not null,
    route jsonb,
    notes text,
    source varchar(24) not null default 'manual',
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    constraint activities_user_id_foreign foreign key (user_id) references public.users (id) on delete cascade
);
create index activities_user_id_started_at_index on public.activities (user_id, started_at);
create index activities_user_id_activity_type_index on public.activities (user_id, activity_type);

create table public.predictions (
    id bigserial primary key,
    user_id bigint not null,
    activity_type varchar(16) not null,
    distance_km numeric(8, 3) not null,
    elevation_gain_m integer not null default 0,
    route jsonb,
    planned_for timestamp(0) with time zone,
    status varchar(16) not null default 'planned',
    duration_min numeric(8, 2) not null,
    duration_low_min numeric(8, 2) not null,
    duration_high_min numeric(8, 2) not null,
    confidence numeric(4, 3) not null default 0.8,
    calories integer not null default 0,
    carbs_per_hour_g smallint not null default 0,
    carbs_total_g integer not null default 0,
    sodium_per_hour_mg integer not null default 0,
    fluid_per_hour_ml integer not null default 0,
    intensity varchar(20) not null default 'moderate',
    met numeric(5, 2),
    payload jsonb,
    model_version varchar(40),
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    constraint predictions_user_id_foreign foreign key (user_id) references public.users (id) on delete cascade
);
create index predictions_user_id_created_at_index on public.predictions (user_id, created_at);

create table public.goals (
    id bigserial primary key,
    user_id bigint not null,
    daily_calories integer not null default 2400,
    daily_distance_km numeric(6, 2) not null default 10,
    daily_active_min smallint not null default 60,
    weekly_calories integer not null default 12000,
    weekly_distance_km numeric(7, 2) not null default 40,
    carb_target_g smallint not null default 360,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    constraint goals_user_id_unique unique (user_id),
    constraint goals_user_id_foreign foreign key (user_id) references public.users (id) on delete cascade
);

create table public.personal_access_tokens (
    id bigserial primary key,
    tokenable_type varchar(255) not null,
    tokenable_id bigint not null,
    name varchar(255) not null,
    token varchar(64) not null,
    abilities text,
    last_used_at timestamp(0) without time zone,
    expires_at timestamp(0) without time zone,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    constraint personal_access_tokens_token_unique unique (token)
);
create index personal_access_tokens_tokenable_type_tokenable_id_index
    on public.personal_access_tokens (tokenable_type, tokenable_id);

-- Spec-compatible views from 2026_11_08_000001_create_spec_compatibility_views.
create view public.user_profiles as
select id, user_id, weight_kg, height_cm, birth_year, sex, sweat_profile,
       experience_level, typical_temperature_c, city, units, onboarded_at, created_at, updated_at
from public.fitness_profiles;

create view public.planned_activities as
select id, user_id, activity_type, distance_km, elevation_gain_m, route,
       planned_for, status, duration_min, duration_low_min, duration_high_min,
       confidence, payload, model_version, created_at, updated_at
from public.predictions;

create view public.nutritional_predictions as
select id as prediction_id, user_id, activity_type, planned_for, calories,
       carbs_per_hour_g, carbs_total_g, sodium_per_hour_mg, fluid_per_hour_ml,
       intensity, met, created_at
from public.predictions;

create view public.activity_routes as
select id as activity_id, user_id, distance_km, elevation_gain_m, started_at, route
from public.activities where route is not null;

create view public.user_goals as
select id, user_id, daily_calories, daily_distance_km, daily_active_min,
       weekly_calories, weekly_distance_km, carb_target_g, created_at, updated_at
from public.goals;

create view public.prediction_history as
select id, user_id, activity_type, planned_for, status, model_version, created_at, updated_at
from public.predictions order by created_at desc;

-- Additional analytical views previously provided by the Supabase SQL schema.
create view public.v_athlete_pace as
select a.user_id, a.activity_type, count(*) as sessions,
       round(sum(a.distance_km), 2) as total_km,
       round(sum(a.duration_min) / 60.0, 2) as total_hours,
       round((sum(a.distance_km) / nullif(sum(a.duration_min) / 60.0, 0))::numeric, 2) as avg_speed_kmh,
       round((sum(a.duration_min) / nullif(sum(a.distance_km), 0))::numeric, 2) as avg_pace_min_km
from public.activities a group by a.user_id, a.activity_type;

create view public.v_daily_totals as
select a.user_id, date_trunc('day', a.started_at)::date as day,
       count(*) as sessions, round(sum(a.distance_km), 2) as distance_km,
       round(sum(a.duration_min), 1) as active_min, sum(a.calories) as calories,
       sum(a.elevation_gain_m) as elevation_gain_m
from public.activities a group by a.user_id, date_trunc('day', a.started_at)::date;

create view public.v_prediction_accuracy as
select p.user_id, p.activity_type, p.duration_min as predicted_min,
       a.duration_min as actual_min,
       round(((a.duration_min - p.duration_min) / nullif(p.duration_min, 0) * 100)::numeric, 1) as error_pct,
       p.model_version, p.created_at
from public.predictions p join public.activities a
  on a.user_id = p.user_id and a.activity_type = p.activity_type
 and a.started_at between p.created_at and p.created_at + interval '3 days';

insert into public.migrations (migration, batch) values
    ('0001_01_01_000000_create_users_table', 1),
    ('0001_01_01_000001_create_cache_table', 1),
    ('0001_01_01_000002_create_jobs_table', 1),
    ('2026_01_01_000000_create_trana_tables', 1),
    ('2026_01_01_000001_create_personal_access_tokens_table', 1),
    ('2026_11_08_000001_create_spec_compatibility_views', 1);
