-- TRANA: daily sessions table (progress tracking that resets at midnight).
--
-- One row per day per user. Tracks calories burned (from activity map)
-- vs calories eaten (from food log).
--
-- Apply with 001_schema.sql + 002_rls.sql on a fresh database, or run
-- php artisan migrate on an existing Laravel database.

-- Daily sessions: one per user per day, reset at midnight.
create table public.daily_sessions (
    id bigserial primary key,
    user_id bigint not null,
    session_date date not null,
    calories_burned integer not null default 0,
    calories_eaten integer not null default 0,
    water_ml integer not null default 0,
    notes text,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    constraint daily_sessions_user_id_foreign
        foreign key (user_id) references public.users (id) on delete cascade,
    constraint daily_sessions_user_date_unique
        unique (user_id, session_date)
);
create index daily_sessions_user_id_session_date_index
    on public.daily_sessions (user_id, session_date);

-- Daily session foods: breakfast, lunch, dinner, snack.
-- Food name is free-text — no predefined dataset required.
create table public.daily_session_foods (
    id bigserial primary key,
    daily_session_id bigint not null,
    meal_type varchar(16) not null, -- breakfast, lunch, dinner, snack
    food_name varchar(255) not null, -- user-entered, no dataset
    calories integer not null default 0,
    carbs_g integer not null default 0,
    protein_g integer not null default 0,
    fat_g integer not null default 0,
    quantity integer not null default 1,
    notes text,
    created_at timestamp(0) without time zone,
    updated_at timestamp(0) without time zone,
    constraint daily_session_foods_daily_session_id_foreign
        foreign key (daily_session_id) references public.daily_sessions (id) on delete cascade
);
create index daily_session_foods_daily_session_id_meal_index
    on public.daily_session_foods (daily_session_id, meal_type);

-- Row-level security.
do $$
declare
    relation_name text;
    role_name text;
begin
    foreach relation_name in array array['daily_sessions', 'daily_session_foods'] loop
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
        'daily_sessions_id_seq', 'daily_session_foods_id_seq'
    ] loop
        execute format('revoke all privileges on sequence public.%I from public', sequence_name);
        for role_name in select rolname from pg_roles where rolname in ('anon', 'authenticated') loop
            execute format('revoke all privileges on sequence public.%I from %I', sequence_name, role_name);
        end loop;
    end loop;
end $$;

insert into public.migrations (migration, batch) values
    ('2026_11_08_130000_create_daily_sessions_table', 4),
    ('2026_11_08_130001_create_daily_session_foods_table', 4);
