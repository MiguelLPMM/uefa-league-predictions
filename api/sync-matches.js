// api/sync-matches.js
//
// Two jobs in one endpoint:
//   1. Keep-alive: any request that touches Supabase counts as activity,
//      preventing the free-tier project from pausing after 7 days idle.
//   2. Sync: fetches all 3 competitions' current-season matches (the same way
//      api/matches/[comp].js does) and hands them to the sync_matches_and_reveal
//      Postgres function, which mirrors them into matches_cache and flips the
//      one-way reveal_unlocked flag once a competition's earliest match has
//      left 'UPCOMING'.
//
// Triggered by a Vercel Cron entry in vercel.json every few days (keep-alive
// cadence), and can also be hit manually/more often without issue — the
// underlying upserts are idempotent.
//
// Uses only the public anon key (same as the frontend) — never the Supabase
// secret key. See the plan file for why this is an accepted "trust-based, not
// tamper-proof" design: this endpoint fetches from our own public
// /api/matches/* data (not caller-supplied), but the RPC it calls doesn't try
// to verify that authenticity from inside Postgres.
const { createClient } = require('@supabase/supabase-js');
const { COMPETITIONS, fetchCompetitionMatches, getSeasonYear } = require('./_lib/uefaMatches');

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

module.exports = async (req, res) => {
    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    const compKeys = Object.keys(COMPETITIONS);

    const results = await Promise.allSettled(
        compKeys.map((compKey) => fetchCompetitionMatches(compKey))
    );

    const rows = [];
    const failures = [];
    results.forEach((result, index) => {
        const compKey = compKeys[index];
        if (result.status === 'fulfilled') {
            result.value.forEach((match) => rows.push(toCacheRow(match, compKey)));
        } else {
            failures.push(compKey);
            console.error(`Failed to fetch ${compKey} matches for sync:`, result.reason);
        }
    });

    if (rows.length === 0) {
        res.status(200).json({ synced: 0, failed: failures });
        return;
    }

    try {
        const { error } = await supabase.rpc('sync_matches_and_reveal', { p_matches: rows });
        if (error) throw error;
        res.status(200).json({ synced: rows.length, failed: failures });
    } catch (error) {
        console.error('sync-matches RPC call failed:', error);
        res.status(500).json({ error: 'Failed to sync matches into Supabase' });
    }
};
