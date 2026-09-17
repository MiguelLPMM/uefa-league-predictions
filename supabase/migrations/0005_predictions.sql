-- Phase 3: Official predictions & the freeze rule.
--
-- Run this in the Supabase SQL Editor, same as the earlier migrations.
-- Idempotent / safe to re-run.

-- ============================================================================
-- match_predictions: the official per-match save for the live mechanism.
-- Written only by save_match_predictions_batch() below — never directly.
-- ============================================================================

create table if not exists public.match_predictions (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users (id) on delete cascade,
    competition text not null check (competition in ('ucl', 'uel', 'uecl')),
    season_year int not null,
    match_id text not null,
    predicted_home int not null,
    predicted_away int not null,
    updated_at timestamptz not null default now(),
    unique (user_id, competition, season_year, match_id)
);

alter table public.match_predictions enable row level security;

-- Reveal gate: you can always see your own predictions; everyone else's
-- become visible once that competition+season's first match has started
-- (competition_seasons.reveal_unlocked, set by sync_matches_and_reveal()).
drop policy if exists "match_predictions visible to owner or after reveal" on public.match_predictions;
create policy "match_predictions visible to owner or after reveal" on public.match_predictions
    for select using (
        auth.uid() = user_id
        or exists (
            select 1 from public.competition_seasons cs
            where cs.competition = match_predictions.competition
                and cs.season_year = match_predictions.season_year
                and cs.reveal_unlocked
        )
    );

grant select on public.match_predictions to anon, authenticated;

-- ============================================================================
-- entries: one row per (user, competition, season) - created on first
-- official save. Its mere existence is what makes someone appear on a
-- leaderboard at all (no placeholder/max-penalty row for non-participants).
-- ============================================================================

create table if not exists public.entries (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references auth.users (id) on delete cascade,
    competition text not null check (competition in ('ucl', 'uel', 'uecl')),
    season_year int not null,
    entry_mode text not null default 'live' check (entry_mode in ('live', 'fixed_rank')),
    is_late boolean not null default false,
    late_weeks int not null default 0,
    submitted_at timestamptz not null default now(),
    unique (user_id, competition, season_year)
);

alter table public.entries enable row level security;

drop policy if exists "entries visible to owner or after reveal" on public.entries;
create policy "entries visible to owner or after reveal" on public.entries
    for select using (
        auth.uid() = user_id
        or exists (
            select 1 from public.competition_seasons cs
            where cs.competition = entries.competition
                and cs.season_year = entries.season_year
                and cs.reveal_unlocked
        )
    );

grant select on public.entries to anon, authenticated;

-- ============================================================================
-- save_match_predictions_batch: the only way match_predictions/entries ever
-- get written. Accepts whatever the client currently has displayed for every
-- match it knows about (including already-FINISHED ones, whose input is
-- disabled and just shows the real score) - the freeze rule below decides
-- what actually gets accepted.
--
-- Freeze rule: a match's saved value locks permanently once it is BOTH
-- (a) FINISHED in matches_cache AND (b) already has a previously-saved
-- value. Before that (not finished yet, or finished but never saved before)
-- a save is free to write/overwrite it. This is also what makes a late
-- entrant's first save auto-accept whatever's shown for already-finished
-- matches (the real score, since that's what a disabled input displays) as
-- a one-time "free" value with no further edits possible afterward.
-- ============================================================================

create or replace function public.save_match_predictions_batch(
    p_competition text,
    p_season_year int,
    p_predictions jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_user_id uuid := auth.uid();
    p jsonb;
    v_match_id text;
    v_home int;
    v_away int;
    v_match_status text;
    v_already_saved boolean;
    v_saved_ids text[] := '{}';
    v_skipped_ids text[] := '{}';
    v_finished_count int;
    v_max_finished_matchday int;
begin
    if v_user_id is null then
        raise exception 'Must be signed in to save predictions';
    end if;
    if p_competition not in ('ucl', 'uel', 'uecl') then
        raise exception 'Unknown competition: %', p_competition;
    end if;

    for p in select * from jsonb_array_elements(p_predictions)
    loop
        v_match_id := p ->> 'match_id';
        v_home := nullif(p ->> 'home', '')::int;
        v_away := nullif(p ->> 'away', '')::int;

        if v_match_id is null or v_home is null or v_away is null then
            continue; -- malformed entry, skip rather than aborting the whole batch
        end if;

        select status into v_match_status
        from public.matches_cache
        where id = v_match_id and competition = p_competition and season_year = p_season_year;

        select exists (
            select 1 from public.match_predictions mp
            where mp.user_id = v_user_id
                and mp.competition = p_competition
                and mp.season_year = p_season_year
                and mp.match_id = v_match_id
        ) into v_already_saved;

        if v_match_status = 'FINISHED' and v_already_saved then
            v_skipped_ids := array_append(v_skipped_ids, v_match_id);
            continue;
        end if;

        insert into public.match_predictions (
            user_id, competition, season_year, match_id, predicted_home, predicted_away, updated_at
        ) values (
            v_user_id, p_competition, p_season_year, v_match_id, v_home, v_away, now()
        )
        on conflict (user_id, competition, season_year, match_id) do update set
            predicted_home = excluded.predicted_home,
            predicted_away = excluded.predicted_away,
            updated_at = now();

        v_saved_ids := array_append(v_saved_ids, v_match_id);
    end loop;

    -- Create the entry on first-ever official save for this (user,
    -- competition, season). Late-entry detection: at this exact moment, was
    -- any match in this competition+season already FINISHED? If so, this is
    -- a late entry, badged with the highest finished matchday number.
    if not exists (
        select 1 from public.entries
        where user_id = v_user_id and competition = p_competition and season_year = p_season_year
    ) then
        select count(*), max(matchday_seq)
        into v_finished_count, v_max_finished_matchday
        from public.matches_cache
        where competition = p_competition and season_year = p_season_year and status = 'FINISHED';

        insert into public.entries (user_id, competition, season_year, entry_mode, is_late, late_weeks, submitted_at)
        values (
            v_user_id, p_competition, p_season_year, 'live',
            coalesce(v_finished_count, 0) > 0,
            coalesce(v_max_finished_matchday, 0),
            now()
        );
    end if;

    return jsonb_build_object('saved', to_jsonb(v_saved_ids), 'skipped', to_jsonb(v_skipped_ids));
end;
$$;

grant execute on function public.save_match_predictions_batch(text, int, jsonb) to authenticated;

-- ============================================================================
-- load_official_predictions: plain read of the caller's own saved
-- predictions for one competition+season.
-- ============================================================================

create or replace function public.load_official_predictions(
    p_competition text,
    p_season_year int
)
returns table (match_id text, predicted_home int, predicted_away int)
language sql
security definer
set search_path = public
as $$
    select match_id, predicted_home, predicted_away
    from public.match_predictions
    where user_id = auth.uid()
        and competition = p_competition
        and season_year = p_season_year;
$$;

grant execute on function public.load_official_predictions(text, int) to authenticated;
