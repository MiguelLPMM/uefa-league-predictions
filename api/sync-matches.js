// api/sync-matches.js
//
// Three jobs in one endpoint, run on every trigger (cron or manual):
//   1. Keep-alive: any request that touches Supabase counts as activity,
//      preventing the free-tier project from pausing after 7 days idle.
//   2. Sync: fetches all 3 competitions' current-season matches and hands
//      them to sync_matches_and_reveal, which mirrors them into
//      matches_cache and flips the one-way reveal_unlocked flag once a
//      competition's earliest match has left 'UPCOMING'.
//   3. Auto-conclude: for every competition+season on record that isn't
//      fully finalized yet (not concluded, or concluded but still missing
//      its season_actual_standings snapshot - see below), fetches that
//      season specifically from the UEFA API (works for past seasons too)
//      and, if every one of its matches is now FINISHED, computes the real
//      final table and calls system_set_actual_standings_and_conclude. This
//      is what makes season conclusion fully automatic - "if all the games
//      are played, it's concluded" - with no admin button anywhere. It's
//      also what backfills 24/25 and 25/26: an earlier migration marked
//      those 'concluded' as a label-only placeholder before this mechanism
//      existed, so they're missing their standings snapshot and get picked
//      up here exactly once.
//
// Triggered by a Vercel Cron entry in vercel.json every few days (keep-alive
// cadence), and can also be hit manually/more often without issue — the
// underlying upserts are idempotent, and a season that's already fully
// finalized (concluded + has standings) is skipped entirely.
//
// Uses only the public anon key (same as the frontend) — never the Supabase
// secret key. See the plan file for why this is an accepted "trust-based, not
// tamper-proof" design: this endpoint only ever calls RPCs with data it
// fetched itself (never caller-supplied), so those RPCs don't need an admin
// check - same reasoning sync_matches_and_reveal already relied on.
const { createClient } = require('@supabase/supabase-js');
const { COMPETITIONS, fetchCompetitionMatches, fetchCompetitionMatchesForSeason, getSeasonYear } = require('./_lib/uefaMatches');
const { computeStandings } = require('./_lib/standings');

const SUPABASE_URL = 'https://vrugexjxkabgbheyvfqq.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_xr0ECxSHU6VvA381cSsvcQ_281IHSWt';

function toCacheRow(match, compKey) {
    const finished = match.status === 'FINISHED';
    return {
        id: match.id,
        competition: compKey,
        season_year: Number(match.seasonYear) || getSeasonYear(),
        matchday_seq: match.matchday ? parseInt(match.matchday.sequenceNumber, 10) : null,
        status: match.status,
        home_team_id: match.homeTeam ? match.homeTeam.id : null,
        home_team_name: match.homeTeam ? match.homeTeam.internationalName : null,
        home_team_logo: match.homeTeam ? match.homeTeam.logoUrl : null,
        away_team_id: match.awayTeam ? match.awayTeam.id : null,
        away_team_name: match.awayTeam ? match.awayTeam.internationalName : null,
        away_team_logo: match.awayTeam ? match.awayTeam.logoUrl : null,
        home_score: finished && match.score ? match.score.total.home : null,
        away_score: finished && match.score ? match.score.total.away : null,
        kickoff_at: match.kickOffTime ? (match.kickOffTime.dateTime || match.kickOffTime.date || null) : null,
    };
}

function toStandingsInput(match) {
    return {
        id: match.id,
        home: { id: match.homeTeam.id, name: match.homeTeam.internationalName, logo: match.homeTeam.logoUrl },
        away: { id: match.awayTeam.id, name: match.awayTeam.internationalName, logo: match.awayTeam.logoUrl },
        homeGoals: match.score.total.home,
        awayGoals: match.score.total.away,
    };
}

module.exports = async (req, res) => {
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const compKeys = Object.keys(COMPETITIONS);

    // --- 1 & 2: keep-alive + sync the current season's live matches ---
    const currentResults = await Promise.allSettled(
        compKeys.map((compKey) => fetchCompetitionMatches(compKey))
    );

    const rows = [];
    const failures = [];
    // Keeps the auto-conclude check below from re-fetching the exact same
    // season a second time - it's the same UEFA API call either way, so a
    // competition whose current season hasn't concluded yet (the common,
    // steady-state case on every run) would otherwise cost two external
    // fetches per cron trigger instead of one.
    const currentMatchesByComp = new Map();
    currentResults.forEach((result, index) => {
        const compKey = compKeys[index];
        if (result.status === 'fulfilled') {
            currentMatchesByComp.set(compKey, result.value);
            result.value.forEach((match) => rows.push(toCacheRow(match, compKey)));
        } else {
            failures.push(compKey);
            console.error(`Failed to fetch ${compKey} matches for sync:`, result.reason);
        }
    });

    let synced = 0;
    if (rows.length > 0) {
        try {
            const { error } = await supabase.rpc('sync_matches_and_reveal', { p_matches: rows });
            if (error) throw error;
            synced = rows.length;
        } catch (error) {
            console.error('sync-matches RPC call failed:', error);
        }
    }

    // --- 3: auto-conclude any season whose league phase has finished ---
    let concluded = 0;
    try {
        const [{ data: allSeasons }, { data: standingsRows }] = await Promise.all([
            supabase.from('competition_seasons').select('competition, season_year, status'),
            supabase.from('season_actual_standings').select('competition, season_year'),
        ]);

        const hasStandings = new Set((standingsRows || []).map((row) => `${row.competition}:${row.season_year}`));
        const seasonsToCheck = (allSeasons || []).filter(
            (season) => season.status !== 'concluded' || !hasStandings.has(`${season.competition}:${season.season_year}`)
        );

        // Fetches run in parallel (this is what api/matches/[comp].js's own
        // sync above already does for the same reason) - on the very first
        // run after a migration, seasonsToCheck can include both historical
        // seasons across all 3 competitions at once, and fetching those
        // sequentially would multiply this function's wall-clock time by
        // however many are pending, risking a serverless timeout. The RPC
        // writes that follow stay sequential - they're cheap, and there's no
        // benefit to parallelizing database writes here.
        const seasonMatchResults = await Promise.allSettled(
            seasonsToCheck.map((season) => {
                const isCurrentSeason = season.season_year === getSeasonYear() && currentMatchesByComp.has(season.competition);
                return isCurrentSeason
                    ? Promise.resolve(currentMatchesByComp.get(season.competition))
                    : fetchCompetitionMatchesForSeason(season.competition, season.season_year);
            })
        );

        for (let i = 0; i < seasonsToCheck.length; i++) {
            const season = seasonsToCheck[i];
            const matchResult = seasonMatchResults[i];
            if (matchResult.status !== 'fulfilled') {
                console.error(`Failed to fetch ${season.competition} ${season.season_year} for auto-conclude:`, matchResult.reason);
                continue;
            }

            try {
                const matches = matchResult.value;
                if (matches.length === 0 || !matches.every((match) => match.status === 'FINISHED')) continue;

                const standings = computeStandings(matches.map(toStandingsInput)).map((team) => ({
                    team_id: team.id,
                    team_name: team.name,
                    team_logo_url: team.logo,
                    actual_rank: team.rank,
                }));

                const { error } = await supabase.rpc('system_set_actual_standings_and_conclude', {
                    p_competition: season.competition,
                    p_season_year: season.season_year,
                    p_standings: standings,
                });
                if (error) throw error;
                concluded++;
            } catch (error) {
                console.error(`Failed to check/conclude ${season.competition} ${season.season_year}:`, error);
            }
        }
    } catch (error) {
        console.error('Failed to load season list for auto-conclude check:', error);
    }

    res.status(200).json({ synced, failed: failures, concluded });
};
