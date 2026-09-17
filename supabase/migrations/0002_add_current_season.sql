-- Phase 1 follow-up: add the season that's actually current right now.
--
-- getSeasonYear() in api/_lib/uefaMatches.js returns currentYear+1 once the
-- calendar hits September — so with today's real date, the season that's
-- actually live (the one sync-matches is fetching) is season_year 2027
-- (the 26/27 season), not 2026. 0001_foundations.sql only seeded 2025 (24/25)
-- and 2026 (25/26), both already-concluded seasons — this is why
-- sync_matches_and_reveal() failed with a foreign key violation on
-- season_year=2027 and matches_cache stayed empty. This file just adds the
-- missing row; run it the same way as 0001 (SQL Editor, safe to re-run).

insert into public.seasons (season_year, label) values
    (2027, '2026/27')
on conflict (season_year) do nothing;

insert into public.competition_seasons (competition, season_year) values
    ('ucl', 2027), ('uel', 2027), ('uecl', 2027)
on conflict (competition, season_year) do nothing;
