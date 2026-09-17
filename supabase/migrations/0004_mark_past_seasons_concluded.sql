-- Phase 1 follow-up #3: 2025 (24/25) and 2026 (25/26) are unambiguously over
-- in real life, so labeling them 'upcoming' forever is wrong, not just
-- incomplete. This is a one-off manual correction, not a new automatic rule —
-- sync_matches_and_reveal() only ever touches the current season (it fetches
-- from the live UEFA API via getSeasonYear(), which never points at a past
-- season), so old seasons have no ongoing mechanism to update their own
-- status and would otherwise stay stuck at 'upcoming' indefinitely.
--
-- Note: this only fixes the label. It does NOT create any real historical
-- data — team_rankings (where actual final standings and imported
-- predictions will live) doesn't exist until Phase 6, and that's still where
-- 24/25's real results and 25/26's imported predictions get entered.

update public.competition_seasons
set status = 'concluded'
where season_year in (2025, 2026);
