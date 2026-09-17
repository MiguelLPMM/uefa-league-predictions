-- Phase 6: multi-season history, guest (no-account) imports, account
-- claiming/merging, and season finalization.
--
-- Run this in the Supabase SQL Editor, same as the earlier migrations.
-- Idempotent / safe to re-run.
--
-- Design notes (see the conversation for the full discussion):
--
-- "Guest" entries let the admin import a past participant's final ranking
-- (24/25, 25/26, and even part of the still-live 26/27 season, for anyone
-- who submitted outside the app) without that person ever having signed in.
-- entries.user_id becomes nullable for this - a guest row has user_id = null
-- and guest_display_name set instead. fixed_rank_predictions references the
-- entry by entries.id (not by user_id directly), which is what makes a
-- nullable/shared-null user_id safe to key against.
--
-- When a guest's real owner eventually signs in, they can self-report which
-- guest entry is theirs (guest_claim_requests); the admin reviews and
-- approves/rejects, or can bypass that entirely and merge any user into any
-- unclaimed entry directly (admin_merge_guest_entry). Approval just flips
-- entries.user_id to the real account - after that it behaves exactly like
-- any other entry.
--
-- For seasons this app never tracked live (24/25, 25/26), there's no
-- matches_cache data to compute an actual table from, so season_actual_
-- standings stores the admin's manually-entered final positions. For the
-- current season, admin_conclude_season + admin_set_actual_standings (fed
-- from a live-computed snapshot) does the same job once its league phase
-- ends - matches_cache/match_predictions rows are never deleted, so a
-- normal 'live' entry's own predicted table still computes exactly as
-- before even after the season is marked concluded.

-- ============================================================================
-- entries: allow guest (no-account) rows.
-- ============================================================================

alter table public.entries alter column user_id drop not null;
alter table public.entries add column if not exists guest_display_name text;

alter table public.entries drop constraint if exists entries_user_or_guest;
alter table public.entries add constraint entries_user_or_guest
    check (user_id is not null or guest_display_name is not null);

-- Two different guests in the same competition+season can't share a name
-- (real users are already deduplicated by the user_id unique constraint from
-- 0005 - nulls never collide with each other there, which is exactly why we
-- need this separate guard for guests specifically).
create unique index if not exists entries_guest_display_name_unique
    on public.entries (competition, season_year, guest_display_name)
    where user_id is null;

-- A concluded season's entries must stay visible even if reveal_unlocked was
-- never flipped for it (true for 24/25 and 25/26, which predate this app and
-- were never synced live).
drop policy if exists "entries visible to owner or after reveal" on public.entries;
create policy "entries visible to owner or after reveal" on public.entries
    for select using (
        auth.uid() = user_id
        or exists (
            select 1 from public.competition_seasons cs
            where cs.competition = entries.competition
                and cs.season_year = entries.season_year
                and (cs.reveal_unlocked or cs.status = 'concluded')
        )
    );

-- Unclaimed guest entries are just a name + which competition/season - safe
-- to show to anyone right away (no predictions leak), and this is what lets
-- a freshly-signed-in user's self-claim prompt find them before reveal.
drop policy if exists "unclaimed guest entries are discoverable" on public.entries;
create policy "unclaimed guest entries are discoverable" on public.entries
    for select using (user_id is null);

drop policy if exists "match_predictions visible to owner or after reveal" on public.match_predictions;
create policy "match_predictions visible to owner or after reveal" on public.match_predictions
    for select using (
        auth.uid() = user_id
        or exists (
            select 1 from public.competition_seasons cs
            where cs.competition = match_predictions.competition
                and cs.season_year = match_predictions.season_year
                and (cs.reveal_unlocked or cs.status = 'concluded')
        )
    );

-- ============================================================================
-- fixed_rank_predictions: the "1-36 list" mechanism - historical seasons and
-- guest imports (no match-by-match data at all, just a final/predicted
-- ranking). Keyed by entries.id rather than user_id so guest rows (user_id
-- is null) work without ambiguity.
-- ============================================================================

create table if not exists public.fixed_rank_predictions (
    id uuid primary key default gen_random_uuid(),
    entry_id uuid not null references public.entries (id) on delete cascade,
    team_id text not null,
    team_name text not null,
    team_logo_url text,
    predicted_rank int not null,
    unique (entry_id, team_id)
);

alter table public.fixed_rank_predictions enable row level security;

drop policy if exists "fixed_rank_predictions follow their entry's visibility" on public.fixed_rank_predictions;
create policy "fixed_rank_predictions follow their entry's visibility" on public.fixed_rank_predictions
    for select using (
        exists (
            select 1 from public.entries e
            join public.competition_seasons cs
                on cs.competition = e.competition and cs.season_year = e.season_year
            where e.id = fixed_rank_predictions.entry_id
                and (auth.uid() = e.user_id or cs.reveal_unlocked or cs.status = 'concluded')
        )
    );

grant select on public.fixed_rank_predictions to anon, authenticated;

-- ============================================================================
-- season_actual_standings: the permanent final-table snapshot for a
-- concluded season - either typed in by hand (24/25) or captured
-- automatically from the live standings at finalize time (admin_conclude_season).
-- ============================================================================

create table if not exists public.season_actual_standings (
    competition text not null check (competition in ('ucl', 'uel', 'uecl')),
    season_year int not null,
    team_id text not null,
    team_name text not null,
    team_logo_url text,
    actual_rank int not null,
    primary key (competition, season_year, team_id)
);

alter table public.season_actual_standings enable row level security;

drop policy if exists "season_actual_standings are publicly readable" on public.season_actual_standings;
create policy "season_actual_standings are publicly readable" on public.season_actual_standings
    for select using (true);

grant select on public.season_actual_standings to anon, authenticated;

-- ============================================================================
-- guest_claim_requests / guest_claim_dismissals: the self-serve "is this you"
-- flow. Requests are self-insertable/visible (RLS), but approving one is
-- admin-only and goes through admin_review_guest_claim below since it has to
-- perform the actual merge as a side effect. Dismissals are plain
-- self-managed rows (like favorites) since there's no side effect to gate.
-- ============================================================================

create table if not exists public.guest_claim_requests (
    id uuid primary key default gen_random_uuid(),
    entry_id uuid not null references public.entries (id) on delete cascade,
    requested_by_user_id uuid not null references auth.users (id) on delete cascade,
    status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
    created_at timestamptz not null default now(),
    resolved_at timestamptz,
    unique (entry_id, requested_by_user_id)
);

alter table public.guest_claim_requests enable row level security;

drop policy if exists "guest_claim_requests visible to requester or admin" on public.guest_claim_requests;
create policy "guest_claim_requests visible to requester or admin" on public.guest_claim_requests
    for select using (
        auth.uid() = requested_by_user_id
        or auth.uid() = '472834c9-c460-4597-9f1e-d29ff8bcb9cc'::uuid
    );

drop policy if exists "users can request their own guest claim" on public.guest_claim_requests;
create policy "users can request their own guest claim" on public.guest_claim_requests
    for insert with check (auth.uid() = requested_by_user_id);

grant select, insert on public.guest_claim_requests to authenticated;

create table if not exists public.guest_claim_dismissals (
    user_id uuid primary key references auth.users (id) on delete cascade,
    dismissed_at timestamptz not null default now()
);

alter table public.guest_claim_dismissals enable row level security;

drop policy if exists "guest_claim_dismissals are self-managed" on public.guest_claim_dismissals;
create policy "guest_claim_dismissals are self-managed" on public.guest_claim_dismissals
    for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

grant select, insert on public.guest_claim_dismissals to authenticated;

-- ============================================================================
-- Admin RPCs. All hardcoded to the product owner's user id, matching
-- public/js/adminConfig.js's ADMIN_USER_ID - keep the two in sync if that
-- ever changes.
-- ============================================================================

create or replace function public.admin_import_guest_entry(
    p_display_name text,
    p_competition text,
    p_season_year int,
    p_rankings jsonb, -- array of { team_name text, predicted_rank int }, ranked 1..N
    p_is_late boolean,
    p_late_weeks int
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
    v_entry_id uuid;
    r jsonb;
begin
    if auth.uid() is distinct from '472834c9-c460-4597-9f1e-d29ff8bcb9cc'::uuid then
        raise exception 'Admin access required';
    end if;
    if p_competition not in ('ucl', 'uel', 'uecl') then
        raise exception 'Unknown competition: %', p_competition;
    end if;
    if p_display_name is null or length(trim(p_display_name)) = 0 then
        raise exception 'Display name is required';
    end if;

    -- Upsert-by-name so re-running an import (fixing a typo, adjusting a
    -- ranking) replaces rather than duplicates.
    select id into v_entry_id
    from public.entries
    where user_id is null
        and guest_display_name = p_display_name
        and competition = p_competition
        and season_year = p_season_year;

    if v_entry_id is null then
        insert into public.entries (user_id, guest_display_name, competition, season_year, entry_mode, is_late, late_weeks, submitted_at)
        values (null, p_display_name, p_competition, p_season_year, 'fixed_rank', coalesce(p_is_late, false), coalesce(p_late_weeks, 0), now())
        returning id into v_entry_id;
    else
        update public.entries
        set is_late = coalesce(p_is_late, false),
            late_weeks = coalesce(p_late_weeks, 0)
        where id = v_entry_id;

        delete from public.fixed_rank_predictions where entry_id = v_entry_id;
    end if;

    for r in select * from jsonb_array_elements(p_rankings)
    loop
        insert into public.fixed_rank_predictions (entry_id, team_id, team_name, team_logo_url, predicted_rank)
        values (
            v_entry_id,
            r ->> 'team_name', -- no separate id available for a historical team - the name doubles as its id
            r ->> 'team_name',
            null,
            (r ->> 'predicted_rank')::int
        );
    end loop;

    return v_entry_id;
end;
$$;

grant execute on function public.admin_import_guest_entry(text, text, int, jsonb, boolean, int) to authenticated;

create or replace function public.admin_set_actual_standings(
    p_competition text,
    p_season_year int,
    p_standings jsonb -- array of { team_id text (optional), team_name text, team_logo_url text (optional), actual_rank int }
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    r jsonb;
begin
    if auth.uid() is distinct from '472834c9-c460-4597-9f1e-d29ff8bcb9cc'::uuid then
        raise exception 'Admin access required';
    end if;
    if p_competition not in ('ucl', 'uel', 'uecl') then
        raise exception 'Unknown competition: %', p_competition;
    end if;

    delete from public.season_actual_standings
    where competition = p_competition and season_year = p_season_year;

    for r in select * from jsonb_array_elements(p_standings)
    loop
        insert into public.season_actual_standings (competition, season_year, team_id, team_name, team_logo_url, actual_rank)
        values (
            p_competition, p_season_year,
            coalesce(nullif(r ->> 'team_id', ''), r ->> 'team_name'),
            r ->> 'team_name',
            nullif(r ->> 'team_logo_url', ''),
            (r ->> 'actual_rank')::int
        );
    end loop;
end;
$$;

grant execute on function public.admin_set_actual_standings(text, int, jsonb) to authenticated;

create or replace function public.admin_conclude_season(
    p_competition text,
    p_season_year int
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
    if auth.uid() is distinct from '472834c9-c460-4597-9f1e-d29ff8bcb9cc'::uuid then
        raise exception 'Admin access required';
    end if;
    update public.competition_seasons
    set status = 'concluded', reveal_unlocked = true
    where competition = p_competition and season_year = p_season_year;
end;
$$;

grant execute on function public.admin_conclude_season(text, int) to authenticated;

-- Core merge primitive: links an unclaimed guest entry to a real account.
-- Also used internally by admin_review_guest_claim below.
create or replace function public.admin_merge_guest_entry(
    p_entry_id uuid,
    p_user_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_competition text;
    v_season_year int;
    v_current_owner uuid;
begin
    if auth.uid() is distinct from '472834c9-c460-4597-9f1e-d29ff8bcb9cc'::uuid then
        raise exception 'Admin access required';
    end if;

    select user_id, competition, season_year into v_current_owner, v_competition, v_season_year
    from public.entries
    where id = p_entry_id;

    if v_competition is null then
        raise exception 'Guest entry not found';
    end if;
    if v_current_owner is not null then
        raise exception 'This entry has already been claimed';
    end if;
    if exists (
        select 1 from public.entries
        where user_id = p_user_id and competition = v_competition and season_year = v_season_year
    ) then
        raise exception 'That user already has an entry for this competition and season';
    end if;

    update public.entries
    set user_id = p_user_id
    where id = p_entry_id;

    -- Any other pending "is this you" requests for the same entry are now moot.
    update public.guest_claim_requests
    set status = 'rejected', resolved_at = now()
    where entry_id = p_entry_id and status = 'pending';
end;
$$;

grant execute on function public.admin_merge_guest_entry(uuid, uuid) to authenticated;

create or replace function public.admin_review_guest_claim(
    p_request_id uuid,
    p_approve boolean
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    v_entry_id uuid;
    v_user_id uuid;
begin
    if auth.uid() is distinct from '472834c9-c460-4597-9f1e-d29ff8bcb9cc'::uuid then
        raise exception 'Admin access required';
    end if;

    select entry_id, requested_by_user_id into v_entry_id, v_user_id
    from public.guest_claim_requests
    where id = p_request_id;

    if v_entry_id is null then
        raise exception 'Claim request not found';
    end if;

    if p_approve then
        perform public.admin_merge_guest_entry(v_entry_id, v_user_id);
        update public.guest_claim_requests
        set status = 'approved', resolved_at = now()
        where id = p_request_id;
    else
        update public.guest_claim_requests
        set status = 'rejected', resolved_at = now()
        where id = p_request_id;
    end if;
end;
$$;

grant execute on function public.admin_review_guest_claim(uuid, boolean) to authenticated;

create or replace function public.admin_find_user_by_email(p_email text)
returns table (user_id uuid, display_name text, avatar_url text)
language plpgsql
security definer
set search_path = public
as $$
begin
    if auth.uid() is distinct from '472834c9-c460-4597-9f1e-d29ff8bcb9cc'::uuid then
        raise exception 'Admin access required';
    end if;
    return query
        select u.id, p.display_name, p.avatar_url
        from auth.users u
        join public.profiles p on p.id = u.id
        where u.email = p_email;
end;
$$;

grant execute on function public.admin_find_user_by_email(text) to authenticated;

-- ============================================================================
-- save_match_predictions_batch: replaced again (see 0007) to add one more
-- rule - an entry that's entry_mode = 'fixed_rank' (a guest import, whether
-- still unclaimed or since merged into a real account) was never a
-- match-by-match submission and can never become one. It stays permanently
-- locked to whatever ranking was imported, regardless of the deadline.
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
    v_entry_mode text;
    v_deadline_passed boolean;
    p jsonb;
    v_match_id text;
    v_home int;
    v_away int;
    v_saved_ids text[] := '{}';
    v_max_finished_matchday int;
begin
    if v_user_id is null then
        raise exception 'Must be signed in to save predictions';
    end if;
    if p_competition not in ('ucl', 'uel', 'uecl') then
        raise exception 'Unknown competition: %', p_competition;
    end if;

    select coalesce(reveal_unlocked, false) into v_deadline_passed
    from public.competition_seasons
    where competition = p_competition and season_year = p_season_year;
    v_deadline_passed := coalesce(v_deadline_passed, false);

    select entry_mode into v_entry_mode
    from public.entries
    where user_id = v_user_id and competition = p_competition and season_year = p_season_year;

    if v_entry_mode = 'fixed_rank' then
        return jsonb_build_object('saved', '[]'::jsonb, 'skipped', '[]'::jsonb, 'locked', true);
    end if;

    -- The one rule from 0007: an existing (live) entry is permanently frozen
    -- once the deadline has passed, regardless of whether it started out
    -- on-time.
    if v_deadline_passed and v_entry_mode is not null then
        return jsonb_build_object('saved', '[]'::jsonb, 'skipped', '[]'::jsonb, 'locked', true);
    end if;

    for p in select * from jsonb_array_elements(p_predictions)
    loop
        v_match_id := p ->> 'match_id';
        v_home := nullif(p ->> 'home', '')::int;
        v_away := nullif(p ->> 'away', '')::int;

        if v_match_id is null or v_home is null or v_away is null then
            continue; -- malformed entry, skip rather than aborting the whole batch
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

    if v_entry_mode is null then
        select max(matchday_seq)
        into v_max_finished_matchday
        from public.matches_cache
        where competition = p_competition and season_year = p_season_year and status = 'FINISHED';

        insert into public.entries (user_id, competition, season_year, entry_mode, is_late, late_weeks, submitted_at)
        values (
            v_user_id, p_competition, p_season_year, 'live',
            v_deadline_passed,
            coalesce(v_max_finished_matchday, 0),
            now()
        );
    end if;

    return jsonb_build_object('saved', to_jsonb(v_saved_ids), 'skipped', '[]'::jsonb, 'locked', false);
end;
$$;

grant execute on function public.save_match_predictions_batch(text, int, jsonb) to authenticated;
