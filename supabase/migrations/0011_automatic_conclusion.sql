-- Phase 6 follow-up to 0010, run after it.
--
-- Two behavior changes:
--
-- 1. Season conclusion is no longer a manual admin action. It's now fully
--    automatic: api/sync-matches.js (the existing daily cron) checks every
--    competition+season on record - current and historical - and once every
--    one of its matches is FINISHED, computes the real final table itself
--    (server-side port of computeStandings, see api/_lib/standings.js) and
--    calls system_set_actual_standings_and_conclude below. This replaces
--    0009's admin_set_actual_standings/admin_conclude_season entirely (both
--    dropped here) - there's no "fetch and save standings" or "lock as
--    concluded" button anywhere anymore. The same mechanism backfills 24/25
--    and 25/26, which an earlier migration (0004) marked 'concluded' as a
--    label-only placeholder before any of this existed - the sync job
--    notices they're concluded but missing a season_actual_standings
--    snapshot and computes it the first time it runs post-migration.
--
--    Not admin-gated: same "trust-based, not tamper-proof" reasoning as
--    sync_matches_and_reveal - only ever fed data the server fetched itself,
--    never caller-supplied.
--
-- 2. admin_merge_guest_key now OVERWRITES any existing entry (and its
--    match_predictions) the target account already has for a competition+
--    season it's being merged into, rather than skipping it. An admin
--    import is assumed authoritative; anything already on the account is
--    assumed to be a stray test/debug submission made before the accounts
--    were linked.
--
-- Run this in the Supabase SQL Editor, after 0010.

drop function if exists public.admin_set_actual_standings(text, int, jsonb);
drop function if exists public.admin_conclude_season(text, int);

create or replace function public.system_set_actual_standings_and_conclude(
    p_competition text,
    p_season_year int,
    p_standings jsonb -- array of { team_id, team_name, team_logo_url, actual_rank }
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
    r jsonb;
begin
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
            r ->> 'team_id', r ->> 'team_name', nullif(r ->> 'team_logo_url', ''), (r ->> 'actual_rank')::int
        );
    end loop;

    update public.competition_seasons
    set status = 'concluded', reveal_unlocked = true
    where competition = p_competition and season_year = p_season_year;
end;
$$;

grant execute on function public.system_set_actual_standings_and_conclude(text, int, jsonb) to anon, authenticated;

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
    v_overwritten jsonb := '[]'::jsonb;
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
            delete from public.match_predictions
            where user_id = p_user_id and competition = v_entry.competition and season_year = v_entry.season_year;

            delete from public.entries
            where user_id = p_user_id and competition = v_entry.competition and season_year = v_entry.season_year;

            v_overwritten := v_overwritten || jsonb_build_object('competition', v_entry.competition, 'season_year', v_entry.season_year);
        end if;

        update public.entries set user_id = p_user_id where id = v_entry.id;
        v_merged_count := v_merged_count + 1;
    end loop;

    if v_merged_count = 0 then
        raise exception 'No unclaimed entries found for that guest key';
    end if;

    update public.guest_claim_requests
    set status = 'rejected', resolved_at = now()
    where guest_key = p_guest_key and status = 'pending';

    return jsonb_build_object('merged', v_merged_count, 'overwritten', v_overwritten);
end;
$$;

grant execute on function public.admin_merge_guest_key(text, uuid) to authenticated;
