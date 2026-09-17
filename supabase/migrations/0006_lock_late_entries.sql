-- Phase 3 follow-up: a late entry is a one-shot submission.
--
-- Once someone's entries.is_late is true (the competition had already
-- started when they first saved), their ENTIRE prediction locks at that
-- first save — including matches that haven't been played yet — not just
-- the ones they missed. An on-time entry keeps the original per-match rule
-- (locks a match only once it's finished AND already saved; anything still
-- unplayed stays editable up to its own kickoff).
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
    v_is_late_entry boolean;
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

    -- NULL if no entry exists yet (this will be the first-ever save).
    select is_late into v_is_late_entry
    from public.entries
    where user_id = v_user_id and competition = p_competition and season_year = p_season_year;

    for p in select * from jsonb_array_elements(p_predictions)
    loop
        v_match_id := p ->> 'match_id';
        v_home := nullif(p ->> 'home', '')::int;
        v_away := nullif(p ->> 'away', '')::int;

        if v_match_id is null or v_home is null or v_away is null then
            continue; -- malformed entry, skip rather than aborting the whole batch
        end if;

        -- A late entry is entirely locked after its first save, regardless
        -- of any individual match's status.
        if v_is_late_entry is true then
            v_skipped_ids := array_append(v_skipped_ids, v_match_id);
            continue;
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
    -- a late entry, badged with the highest finished matchday number, and
    -- (per the loop above) locked from here on.
    if v_is_late_entry is null then
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

    return jsonb_build_object(
        'saved', to_jsonb(v_saved_ids),
        'skipped', to_jsonb(v_skipped_ids),
        'locked', coalesce(v_is_late_entry, false)
    );
end;
$$;

grant execute on function public.save_match_predictions_batch(text, int, jsonb) to authenticated;
