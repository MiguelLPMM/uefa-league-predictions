-- Phase 6 fix-up: guest entries need a stable identity key so the same real
-- person's imports across multiple competitions/seasons can be merged to
-- their account in one action, and guest predicted rankings need to use
-- REAL team ids (not the typed name) so they actually match up against the
-- real actual standings later - see the conversation for the full bug
-- report (every guest off-value was silently coming out blank because
-- 0009's admin_import_guest_entry stored team_id = team_name, which never
-- matches the real UEFA team id the live/actual side uses).
--
-- Run this in the Supabase SQL Editor, same as the earlier migrations.
--
-- This is NOT purely idempotent on data: it deletes any guest entry created
-- before this migration (they have no guest_key and, per the bug above, are
-- already broken - their off-values could never have computed correctly).
-- Re-import them from the admin panel afterward; the schema/RPC changes
-- below are what make the re-import actually work.

-- ============================================================================
-- Clean up pre-guest_key guest data (broken by the bug above anyway).
-- ============================================================================

delete from public.fixed_rank_predictions
where entry_id in (select id from public.entries where user_id is null);

delete from public.guest_claim_requests; -- entry_id column is being dropped below

delete from public.entries where user_id is null;

-- ============================================================================
-- entries: add the stable guest_key identity.
-- ============================================================================

alter table public.entries add column if not exists guest_key text;

alter table public.entries drop constraint if exists entries_user_or_guest;
alter table public.entries add constraint entries_user_or_guest
    check (user_id is not null or (guest_display_name is not null and guest_key is not null));

alter table public.entries drop constraint if exists entries_guest_key_format;
alter table public.entries add constraint entries_guest_key_format
    check (guest_key is null or guest_key ~ '^[a-z0-9_-]+$');

drop index if exists entries_guest_display_name_unique;
create unique index if not exists entries_guest_key_unique
    on public.entries (competition, season_year, guest_key)
    where user_id is null;

-- ============================================================================
-- guest_claim_requests: reference the shared guest_key (an identity that can
-- span multiple competitions/seasons) instead of one specific entry row, so
-- approving a request merges everything tied to that person at once.
-- ============================================================================

alter table public.guest_claim_requests drop column if exists entry_id;
alter table public.guest_claim_requests add column if not exists guest_key text not null default '';
alter table public.guest_claim_requests alter column guest_key drop default;

alter table public.guest_claim_requests drop constraint if exists guest_claim_requests_entry_id_requested_by_user_id_key;
alter table public.guest_claim_requests drop constraint if exists guest_claim_requests_guest_key_requested_by_user_id_key;
alter table public.guest_claim_requests add constraint guest_claim_requests_guest_key_requested_by_user_id_key
    unique (guest_key, requested_by_user_id);

-- ============================================================================
-- admin_import_guest_entry: now keyed by (guest_key, competition, season)
-- instead of guest_display_name, and rankings carry real team_id/team_logo_url
-- (fetched from the UEFA API client-side - see seasonMatches.js) instead of
-- using the typed team name as a fake id.
-- ============================================================================

drop function if exists public.admin_import_guest_entry(text, text, int, jsonb, boolean, int);

create or replace function public.admin_import_guest_entry(
    p_guest_key text,
    p_display_name text,
    p_competition text,
    p_season_year int,
    p_rankings jsonb, -- array of { team_id text, team_name text, team_logo_url text, predicted_rank int }
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
    if p_guest_key is null or p_guest_key !~ '^[a-z0-9_-]+$' then
        raise exception 'Guest key must be lowercase letters/numbers/hyphens/underscores only';
    end if;
    if p_display_name is null or length(trim(p_display_name)) = 0 then
        raise exception 'Display name is required';
    end if;

    -- Upsert-by-(guest_key, competition, season) so re-running an import
    -- (fixing a ranking, adjusting weeks late) replaces rather than duplicates.
    select id into v_entry_id
    from public.entries
    where user_id is null
        and guest_key = p_guest_key
        and competition = p_competition
        and season_year = p_season_year;

    if v_entry_id is null then
        insert into public.entries (user_id, guest_key, guest_display_name, competition, season_year, entry_mode, is_late, late_weeks, submitted_at)
        values (null, p_guest_key, p_display_name, p_competition, p_season_year, 'fixed_rank', coalesce(p_is_late, false), coalesce(p_late_weeks, 0), now())
        returning id into v_entry_id;
    else
        update public.entries
        set guest_display_name = p_display_name,
            is_late = coalesce(p_is_late, false),
            late_weeks = coalesce(p_late_weeks, 0)
        where id = v_entry_id;

        delete from public.fixed_rank_predictions where entry_id = v_entry_id;
    end if;

    for r in select * from jsonb_array_elements(p_rankings)
    loop
        insert into public.fixed_rank_predictions (entry_id, team_id, team_name, team_logo_url, predicted_rank)
        values (
            v_entry_id,
            coalesce(nullif(r ->> 'team_id', ''), r ->> 'team_name'),
            r ->> 'team_name',
            nullif(r ->> 'team_logo_url', ''),
            (r ->> 'predicted_rank')::int
        );
    end loop;

    return v_entry_id;
end;
$$;

grant execute on function public.admin_import_guest_entry(text, text, text, int, jsonb, boolean, int) to authenticated;

-- ============================================================================
-- admin_merge_guest_key: replaces admin_merge_guest_entry. Merges every
-- still-unclaimed entry sharing a guest_key into one real account at once -
-- skipping (not failing on) any single competition+season where that user
-- already has their own entry, since that shouldn't block merging the rest.
-- ============================================================================

drop function if exists public.admin_merge_guest_entry(uuid, uuid);

create or replace function public.admin_merge_guest_key(
    p_guest_key text,
    p_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    v_entry record;
    v_merged_count int := 0;
    v_skipped jsonb := '[]'::jsonb;
begin
    if auth.uid() is distinct from '472834c9-c460-4597-9f1e-d29ff8bcb9cc'::uuid then
        raise exception 'Admin access required';
    end if;

    for v_entry in
        select id, competition, season_year
        from public.entries
        where guest_key = p_guest_key and user_id is null
    loop
        if exists (
            select 1 from public.entries
            where user_id = p_user_id and competition = v_entry.competition and season_year = v_entry.season_year
        ) then
            v_skipped := v_skipped || jsonb_build_object('competition', v_entry.competition, 'season_year', v_entry.season_year);
            continue;
        end if;

        update public.entries set user_id = p_user_id where id = v_entry.id;
        v_merged_count := v_merged_count + 1;
    end loop;

    if v_merged_count = 0 and jsonb_array_length(v_skipped) = 0 then
        raise exception 'No unclaimed entries found for that guest key';
    end if;

    update public.guest_claim_requests
    set status = 'rejected', resolved_at = now()
    where guest_key = p_guest_key and status = 'pending';

    return jsonb_build_object('merged', v_merged_count, 'skipped', v_skipped);
end;
$$;

grant execute on function public.admin_merge_guest_key(text, uuid) to authenticated;

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
    v_guest_key text;
    v_user_id uuid;
begin
    if auth.uid() is distinct from '472834c9-c460-4597-9f1e-d29ff8bcb9cc'::uuid then
        raise exception 'Admin access required';
    end if;

    select guest_key, requested_by_user_id into v_guest_key, v_user_id
    from public.guest_claim_requests
    where id = p_request_id;

    if v_guest_key is null then
        raise exception 'Claim request not found';
    end if;

    if p_approve then
        perform public.admin_merge_guest_key(v_guest_key, v_user_id);
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
