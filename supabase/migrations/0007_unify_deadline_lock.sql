-- Phase 3 correction: the freeze rule was per-match (locking a match once it
-- individually finished) — but the actual intent is a single whole-
-- competition deadline. Once a competition+season's first match has started
-- (competition_seasons.reveal_unlocked), ANY existing entry is frozen for
-- good, whether it was originally on-time or late — an on-time saver doesn't
-- get to keep editing future matches after the deadline any more than a
-- late joiner does. Before the deadline, saving stays fully unrestricted for
-- everyone (multiple re-saves, no locking at all).
--
-- A brand new entry created *after* the deadline (a late signup) is still
-- accepted exactly once — that single save becomes its permanently locked
-- state — then falls under the same "entry exists + deadline passed" rule
-- as everyone else from that point on.
--
-- This replaces the per-match matches_cache/is_late-branching logic from
-- 0005/0006 entirely; matches_cache's FINISHED status is no longer consulted
-- here at all (it's still used for the live client-side table rendering,
-- just not for this freeze decision).
--
-- Run this the same way as the earlier migrations.

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
    v_entry_exists boolean;
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

    select exists (
        select 1 from public.entries
        where user_id = v_user_id and competition = p_competition and season_year = p_season_year
    ) into v_entry_exists;

    -- The one rule: an existing entry is permanently frozen once the
    -- deadline has passed, regardless of whether it started out on-time.
    if v_deadline_passed and v_entry_exists then
        return jsonb_build_object('saved', '[]'::jsonb, 'skipped', '[]'::jsonb, 'locked', true);
    end if;

    -- Otherwise: either the deadline hasn't passed yet (ordinary, freely
    -- re-saveable edits), or this is a first-ever save happening after the
    -- deadline (a late signup) — both accept the full batch as given.
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

    if not v_entry_exists then
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
