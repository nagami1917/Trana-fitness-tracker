-- ===========================================================================
-- TRANA — Supabase PostgreSQL schema
-- ===========================================================================
-- Run this in the Supabase SQL editor (or `supabase db push`).
-- It mirrors backend/database/migrations exactly; keep the two in sync.
--
--   supabase link --project-ref <ref>
--   psql "$SUPABASE_DB_URL" -f supabase/sql/001_schema.sql
--   psql "$SUPABASE_DB_URL" -f supabase/sql/002_rls.sql
--
-- NOTE: PostgreSQL only. TRANA never uses MySQL.
-- ===========================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- users  (owned by Laravel/Sanctum; Supabase Auth is optional — see 002_rls)
-- ---------------------------------------------------------------------------
create table if not exists public.users (
    id                bigserial primary key,
    name              varchar(255) not null,
    email             varchar(255) not null unique,
    email_verified_at timestamptz,
    password          varchar(255) not null,
    remember_token    varchar(100),
    created_at        timestamptz not null default now(),
    updated_at        timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- fitness_profiles — one per athlete, feeds the duration + fueling models
-- ---------------------------------------------------------------------------
create table if not exists public.fitness_profiles (
    id                     bigserial primary key,
    user_id                bigint not null unique references public.users (id) on delete cascade,
    weight_kg              numeric(5, 2) not null check (weight_kg between 25 and 250),
    height_cm              numeric(5, 1),
    birth_year             smallint,
    sex                    varchar(16) not null default 'other'
                             check (sex in ('female', 'male', 'other')),
    sweat_profile          varchar(16) not null default 'normal'
                             check (sweat_profile in ('low', 'normal', 'high')),
    experience_level       smallint not null default 1 check (experience_level between 1 and 5),
    typical_temperature_c  numeric(4, 1) not null default 26,
    city                   varchar(120),
    units                  varchar(10) not null default 'metric',
    onboarded_at           timestamptz,
    created_at             timestamptz not null default now(),
    updated_at             timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- activities — the training corpus (one row per completed session)
-- ---------------------------------------------------------------------------
create table if not exists public.activities (
    id               bigserial primary key,
    user_id          bigint not null references public.users (id) on delete cascade,
    activity_type    varchar(16) not null
                       check (activity_type in ('run', 'ride', 'walk', 'hike')),
    distance_km      numeric(8, 3) not null check (distance_km > 0),
    elevation_gain_m integer not null default 0 check (elevation_gain_m >= 0),
    duration_min     numeric(8, 2) not null check (duration_min > 0),
    calories         integer,
    avg_heart_rate   smallint,
    started_at       timestamptz not null,
    route            jsonb,               -- [[lat, lng], ...]
    notes            text,
    source           varchar(24) not null default 'manual',
    created_at       timestamptz not null default now(),
    updated_at       timestamptz not null default now()
);

create index if not exists activities_user_started_idx on public.activities (user_id, started_at desc);
create index if not exists activities_user_type_idx    on public.activities (user_id, activity_type);
create index if not exists activities_started_idx      on public.activities (started_at desc);

-- ---------------------------------------------------------------------------
-- predictions — saved fueling plans (audit trail for the ML model)
-- ---------------------------------------------------------------------------
create table if not exists public.predictions (
    id                 bigserial primary key,
    user_id            bigint not null references public.users (id) on delete cascade,
    activity_type      varchar(16) not null
                         check (activity_type in ('run', 'ride', 'walk', 'hike')),
    distance_km        numeric(8, 3) not null,
    elevation_gain_m   integer not null default 0,
    route              jsonb,
    planned_for        timestamptz,
    status             varchar(16) not null default 'planned'
                         check (status in ('planned', 'completed', 'cancelled')),

    duration_min       numeric(8, 2) not null,
    duration_low_min   numeric(8, 2) not null,
    duration_high_min  numeric(8, 2) not null,
    confidence         numeric(4, 3) not null default 0.8,

    calories           integer not null default 0,
    carbs_per_hour_g   smallint not null default 0,
    carbs_total_g      integer not null default 0,
    sodium_per_hour_mg integer not null default 0,
    fluid_per_hour_ml  integer not null default 0,
    intensity          varchar(20) not null default 'moderate',
    met                numeric(5, 2),

    payload            jsonb,             -- full recommendation returned by the ML service
    model_version      varchar(40),
    created_at         timestamptz not null default now(),
    updated_at         timestamptz not null default now()
);

create index if not exists predictions_user_created_idx on public.predictions (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- goals
-- ---------------------------------------------------------------------------
create table if not exists public.goals (
    id                  bigserial primary key,
    user_id             bigint not null unique references public.users (id) on delete cascade,
    daily_calories      integer not null default 2400,
    daily_distance_km   numeric(6, 2) not null default 10,
    daily_active_min    smallint not null default 60,
    weekly_calories     integer not null default 12000,
    weekly_distance_km  numeric(7, 2) not null default 40,
    carb_target_g       smallint not null default 360,
    created_at          timestamptz not null default now(),
    updated_at          timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Convenience views used by the ML service and any BI/analysis work
-- ---------------------------------------------------------------------------

-- Per-athlete, per-modality reference pace (Riegel curve inputs).
create or replace view public.v_athlete_pace as
select
    a.user_id,
    a.activity_type,
    count(*)                                         as sessions,
    round(sum(a.distance_km), 2)                     as total_km,
    round(sum(a.duration_min) / 60.0, 2)             as total_hours,
    round((sum(a.distance_km) / nullif(sum(a.duration_min) / 60.0, 0))::numeric, 2) as avg_speed_kmh,
    round((sum(a.duration_min) / nullif(sum(a.distance_km), 0))::numeric, 2)        as avg_pace_min_km
from public.activities a
group by a.user_id, a.activity_type;

-- Daily rollup powering the dashboard cards.
create or replace view public.v_daily_totals as
select
    a.user_id,
    date_trunc('day', a.started_at)::date as day,
    count(*)                              as sessions,
    round(sum(a.distance_km), 2)          as distance_km,
    round(sum(a.duration_min), 1)         as active_min,
    sum(a.calories)                       as calories,
    sum(a.elevation_gain_m)               as elevation_gain_m
from public.activities a
group by a.user_id, date_trunc('day', a.started_at)::date;

-- Model accuracy tracking: once an athlete completes a planned session, we can
-- compare the stored prediction with reality.
create or replace view public.v_prediction_accuracy as
select
    p.user_id,
    p.activity_type,
    p.duration_min            as predicted_min,
    a.duration_min            as actual_min,
    round(((a.duration_min - p.duration_min) / nullif(p.duration_min, 0) * 100)::numeric, 1) as error_pct,
    p.model_version,
    p.created_at
from public.predictions p
join public.activities a
  on a.user_id = p.user_id
 and a.activity_type = p.activity_type
 and a.started_at between p.created_at and p.created_at + interval '3 days';

-- ---------------------------------------------------------------------------
-- Spec-compatible views (read-only) — the original product spec names the
-- persistence layer user_profiles / planned_activities / nutritional_predictions
-- (+ activity_routes / user_goals / prediction_history). TRANA stores the
-- richer real schema; these views expose the spec names without duplicating data.
-- Writes must keep flowing through the API (read-only views).
-- ---------------------------------------------------------------------------

create or replace view public.user_profiles as
select id, user_id, weight_kg, height_cm, birth_year, sex,
       sweat_profile, experience_level, typical_temperature_c,
       city, units, onboarded_at, created_at, updated_at
from public.fitness_profiles;

create or replace view public.planned_activities as
select id, user_id, activity_type, distance_km, elevation_gain_m,
       route, planned_for, status,
       duration_min, duration_low_min, duration_high_min,
       confidence, payload, model_version, created_at, updated_at
from public.predictions;

create or replace view public.nutritional_predictions as
select p.id as prediction_id, p.user_id, p.activity_type, p.planned_for,
       p.calories, p.carbs_per_hour_g, p.carbs_total_g,
       p.sodium_per_hour_mg, p.fluid_per_hour_ml,
       p.intensity, p.met, p.created_at
from public.predictions p;

create or replace view public.activity_routes as
select a.id as activity_id, a.user_id, a.distance_km, a.elevation_gain_m,
       a.started_at, a.route
from public.activities a
where a.route is not null;

create or replace view public.user_goals as
select id, user_id, daily_calories, daily_distance_km, daily_active_min,
       weekly_calories, weekly_distance_km, carb_target_g,
       created_at, updated_at
from public.goals;

create or replace view public.prediction_history as
select id, user_id, activity_type, planned_for, status,
       model_version, created_at, updated_at
from public.predictions
order by created_at desc;
