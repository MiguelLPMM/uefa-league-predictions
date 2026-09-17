-- Phase 1: Foundations
--
-- HOW TO RUN THIS: open your Supabase project's dashboard -> SQL Editor ->
-- New query, paste this whole file, and click Run. I don't have (and
-- shouldn't have) direct database credentials, so schema changes in this
-- project are applied this way: I write the migration file, you run it.
--
-- Safe to re-run: every statement below is idempotent (IF NOT EXISTS /
-- ON CONFLICT DO NOTHING), so re-running this file after a partial failure
-- won't duplicate data or error out on objects that already exist.

create extension if not exists pgcrypto;

-- ============================================================================
-- profiles: 1:1 mirror of auth.users, needed because auth.users itself isn't
-- readable by other users under RLS, but display names must be visible on the
-- leaderboard.
-- ============================================================================

create table if not exists public.profiles (
    id uuid primary key references auth.users (id) on delete cascade,
    display_name text,
    avatar_url text,
    created_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "profiles are publicly readable" on public.profiles;
create policy "profiles are publicly readable" on public.profiles
    for select using (true);

drop policy if exists "users can update their own profile" on public.profiles;
create policy "users can update their own profile" on public.profiles
    for update using (auth.uid() = id);

grant select on public.profiles to anon, authenticated;
grant update (display_name, avatar_url) on public.profiles to authenticated;

-- Auto-create a profile row whenever someone signs in for the first time.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
    insert into public.profiles (id, display_name, avatar_url)
    values (
        new.id,
        coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name', new.email),
        new.raw_user_meta_data ->> 'avatar_url'
    )
    on conflict (id) do nothing;
    return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
    after insert on auth.users
    for each row execute function public.handle_new_user();

-- ============================================================================
-- seasons / competition_seasons
-- ============================================================================

create table if not exists public.seasons (
    season_year int primary key,
    label text not null
);

alter table public.seasons enable row level security;

drop policy if exists "seasons are publicly readable" on public.seasons;
create policy "seasons are publicly readable" on public.seasons
    for select using (true);

grant select on public.seasons to anon, authenticated;

insert into public.seasons (season_year, label) values
    (2025, '2024/25'),
    (2026, '2025/26')
on conflict (season_year) do nothing;

create table if not exists public.competition_seasons (
    id uuid primary key default gen_random_uuid(),
    competition text not null check (competition in ('ucl', 'uel', 'uecl')),
    season_year int not null references public.seasons (season_year),
    reveal_unlocked boolean not null default false,
    status text not null default 'upcoming' check (status in ('upcoming', 'live', 'concluded')),
    unique (competition, season_year)
);

alter table public.competition_seasons enable row level security;

drop policy if exists "competition_seasons are publicly readable" on public.competition_seasons;
create policy "competition_seasons are publicly readable" on public.competition_seasons
    for select using (true);

grant select on public.competition_seasons to anon, authenticated;

insert into public.competition_seasons (competition, season_year) values
    ('ucl', 2025), ('uel', 2025), ('uecl', 2025),
    ('ucl', 2026), ('uel', 2026), ('uecl', 2026)
on conflict (competition, season_year) do nothing;

-- ============================================================================
-- matches_cache: our own trustworthy mirror of live UEFA match state, written
-- only by sync_matches_and_reveal() below (never directly by anon/authenticated).
-- ============================================================================

create table if not exists public.matches_cache (
    id text primary key,
    competition text not null check (competition in ('ucl', 'uel', 'uecl')),
    season_year int not null,
    matchday_seq int,
    status text not null,
    home_team_id text,
    home_team_name text,
    home_team_logo text,
    away_team_id text,
    away_team_name text,
    away_team_logo text,
    home_score int,
    away_score int,
    kickoff_at timestamptz,
    updated_at timestamptz not null default now()
);

alter table public.matches_cache enable row level security;

drop policy if exists "matches_cache is publicly readable" on public.matches_cache;
create policy "matches_cache is publicly readable" on public.matches_cache
    for select using (true);

grant select on public.matches_cache to anon, authenticated;

-- ============================================================================
-- sync_matches_and_reveal: the only way matches_cache / reveal_unlocked ever
-- get written. Called by a Vercel Cron endpoint (and, later, opportunistically
-- from the frontend) which itself fetches /api/matches/{comp} and passes the
-- results in as p_matches. This is the "trust-based, not tamper-proof" design
-- agreed on: it's a SECURITY DEFINER function so it can write to tables
-- anon/authenticated have no direct write grant on, but it does trust its
-- caller-supplied payload rather than fetching independently from inside
-- Postgres. Accepted trade-off for a friends prediction game — see the plan
-- file for the reasoning.
--
-- p_matches shape: a jsonb array of objects with keys:
--   id, competition, season_year, matchday_seq, status,
--   home_team_id, home_team_name, home_team_logo,
--   away_team_id, away_team_name, away_team_logo,
--   home_score, away_score, kickoff_at
-- ============================================================================

create or replace function public.sync_matches_and_reveal(p_matches jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    m jsonb;
    v_competition text;
    v_season_year int;
begin
    for m in select * from jsonb_array_elements(p_matches)
    loop
        v_competition := m ->> 'competition';
        v_season_year := (m ->> 'season_year')::int;

        if v_competition not in ('ucl', 'uel', 'uecl') or v_season_year is null then
            continue; -- ignore malformed rows rather than aborting the whole batch
        end if;

        insert into public.competition_seasons (competition, season_year)
        values (v_competition, v_season_year)
        on conflict (competition, season_year) do nothing;

        insert into public.matches_cache (
            id, competition, season_year, matchday_seq, status,
            home_team_id, home_team_name, home_team_logo,
            away_team_id, away_team_name, away_team_logo,
            home_score, away_score, kickoff_at, updated_at
        ) values (
            m ->> 'id', v_competition, v_season_year, nullif(m ->> 'matchday_seq', '')::int, m ->> 'status',
            m ->> 'home_team_id', m ->> 'home_team_name', m ->> 'home_team_logo',
            m ->> 'away_team_id', m ->> 'away_team_name', m ->> 'away_team_logo',
            nullif(m ->> 'home_score', '')::int, nullif(m ->> 'away_score', '')::int,
            nullif(m ->> 'kickoff_at', '')::timestamptz, now()
        )
        on conflict (id) do update set
            status = excluded.status,
            matchday_seq = excluded.matchday_seq,
            home_score = excluded.home_score,
            away_score = excluded.away_score,
            kickoff_at = excluded.kickoff_at,
            updated_at = now();
    end loop;

    -- One-way reveal: once a competition+season's earliest-kickoff match has
    -- left 'UPCOMING' (i.e. it's LIVE/CURRENT/FINISHED/ABANDONED/CANCELED),
    -- unlock it permanently. Never flips back to false.
    update public.competition_seasons cs
    set reveal_unlocked = true
    where not cs.reveal_unlocked
        and exists (
            select 1
            from public.matches_cache mc
            where mc.competition = cs.competition
                and mc.season_year = cs.season_year
                and mc.status <> 'UPCOMING'
                and mc.kickoff_at = (
                    select min(mc2.kickoff_at)
                    from public.matches_cache mc2
                    where mc2.competition = cs.competition
                        and mc2.season_year = cs.season_year
                )
        );
end;
$$;

grant execute on function public.sync_matches_and_reveal(jsonb) to anon, authenticated;
