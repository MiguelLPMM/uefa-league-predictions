-- Phase 1 follow-up #2: sync_matches_and_reveal() flips reveal_unlocked but
-- never actually moved competition_seasons.status from 'upcoming' to 'live' —
-- a gap in the original function, not something dependent on 0001/0002.
-- 'concluded' still only ever gets set later by the admin "finalize season"
-- action (Phase 6); this just wires up the upcoming -> live half.
--
-- Includes a one-off backfill for the two rows that already flipped
-- reveal_unlocked to TRUE under the old function, before this fix existed.

update public.competition_seasons
set status = 'live'
where status = 'upcoming' and reveal_unlocked = true;

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
    -- unlock it permanently and bump status past 'upcoming'. Never flips
    -- reveal_unlocked back to false, and never touches a 'concluded' status
    -- (that's admin-only, set by the future "finalize season" action).
    update public.competition_seasons cs
    set reveal_unlocked = true,
        status = case when cs.status = 'upcoming' then 'live' else cs.status end
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
