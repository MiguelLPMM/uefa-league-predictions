// Data for the History charts: a player's score in every season of a competition.
// Score = the same total |predicted rank - actual rank| the leaderboard uses (lower is
// better), computed the same way per entry: a fixed-rank entry uses its stored list, a live
// entry is projected from its match predictions; the actual table is the concluded season's
// snapshot, or the partial table built from finished matches while a season is running.
// Everything is read through RLS, so only entries the viewer may see (their own, or those of
// a revealed/concluded season) ever show up.
import { supabaseClient } from '../supabaseClient.js';
import { computeActualStandings, computeUserPredictedStandings, computeOffsets } from '../scoring.js';

const PAGE_SIZE = 1000; // PostgREST returns at most this many rows per request

const check = ({ data, error }) => {
    if (error) throw error;
    return data || [];
};

// Reads every row of a query by paging through it (predictions and fixed-rank lists pass the
// 1000-row cap quickly once several seasons are loaded together). The query must be ordered.
async function fetchAll(buildQuery) {
    const rows = [];
    for (let from = 0; ; from += PAGE_SIZE) {
        const page = check(await buildQuery().range(from, from + PAGE_SIZE - 1));
        rows.push(...page);
        if (page.length < PAGE_SIZE) break;
    }
    return rows;
}

const seasonLabel = (seasonYear) => `${seasonYear - 1}/${String(seasonYear).slice(-2)}`;

// One competition, every season on record. options.onlyUserId limits it to one account's
// entries (the Profile page); options.selfId marks that account's line in the shared chart.
async function buildCompetitionHistory(comp, { onlyUserId = null, selfId = null } = {}) {
    const seasons = check(await supabaseClient
        .from('competition_seasons')
        .select('season_year, status')
        .eq('competition', comp)
        .order('season_year', { ascending: true }));
    if (!seasons.length) return { seasons: [], series: [] };

    let entryQuery = supabaseClient
        .from('entries')
        .select('id, user_id, guest_key, guest_display_name, guest_color, entry_mode, is_late, late_weeks, season_year, submitted_at')
        .eq('competition', comp);
    if (onlyUserId) entryQuery = entryQuery.eq('user_id', onlyUserId);
    const entries = check(await entryQuery);
    if (!entries.length) return { seasons: [], series: [] };

    const statusByYear = new Map(seasons.map((s) => [s.season_year, s.status]));
    const concludedYears = seasons.filter((s) => s.status === 'concluded').map((s) => s.season_year);
    // matches are needed to build a running season's partial table and to project live entries
    const matchYears = [...new Set([
        ...seasons.filter((s) => s.status !== 'concluded').map((s) => s.season_year),
        ...entries.filter((e) => e.entry_mode !== 'fixed_rank').map((e) => e.season_year),
    ])];
    const liveEntryIds = new Set(entries.filter((e) => e.entry_mode !== 'fixed_rank').map((e) => e.id));
    const hasFixedRank = entries.some((e) => e.entry_mode === 'fixed_rank');

    const userIds = [...new Set(entries.map((e) => e.user_id).filter(Boolean))];
    const [profileRows, actualRows, matchRows, fixedRows, predictionRows] = await Promise.all([
        userIds.length
            ? supabaseClient.from('profiles').select('id, display_name, avatar_url, chart_color, created_at').in('id', userIds).then(check)
            : [],
        concludedYears.length
            ? fetchAll(() => supabaseClient
                .from('season_actual_standings')
                .select('season_year, team_id, team_name, team_logo_url, actual_rank')
                .eq('competition', comp)
                .in('season_year', concludedYears)
                .order('season_year').order('actual_rank'))
            : [],
        matchYears.length
            ? fetchAll(() => supabaseClient
                .from('matches_cache')
                .select('id, season_year, status, home_team_id, home_team_name, home_team_logo, away_team_id, away_team_name, away_team_logo, home_score, away_score')
                .eq('competition', comp)
                .in('season_year', matchYears)
                .order('season_year').order('id'))
            : [],
        hasFixedRank
            ? fetchAll(() => {
                let query = supabaseClient
                    .from('fixed_rank_predictions')
                    .select('entry_id, team_id, team_name, team_logo_url, predicted_rank, entries!inner(competition, user_id)')
                    .eq('entries.competition', comp);
                if (onlyUserId) query = query.eq('entries.user_id', onlyUserId);
                return query.order('entry_id').order('predicted_rank');
            })
            : [],
        liveEntryIds.size
            ? fetchAll(() => {
                let query = supabaseClient
                    .from('match_predictions')
                    .select('user_id, season_year, match_id, predicted_home, predicted_away')
                    .eq('competition', comp);
                if (onlyUserId) query = query.eq('user_id', onlyUserId);
                return query.order('user_id').order('season_year').order('match_id');
            })
            : [],
    ]);

    const profiles = new Map(profileRows.map((p) => [p.id, p]));

    // every season's actual table: the concluded snapshot, or the partial one from finished matches
    const matchesByYear = new Map();
    matchRows.forEach((row) => {
        if (!matchesByYear.has(row.season_year)) matchesByYear.set(row.season_year, []);
        matchesByYear.get(row.season_year).push(row);
    });
    const actualByYear = new Map();
    actualRows.forEach((row) => {
        if (!actualByYear.has(row.season_year)) actualByYear.set(row.season_year, []);
        actualByYear.get(row.season_year).push({ id: row.team_id, name: row.team_name, logo: row.team_logo_url, rank: row.actual_rank });
    });
    const tableOf = (year) => (statusByYear.get(year) === 'concluded'
        ? actualByYear.get(year) || []
        : computeActualStandings(matchesByYear.get(year) || []));

    const fixedByEntry = new Map();
    fixedRows.forEach((row) => {
        if (!fixedByEntry.has(row.entry_id)) fixedByEntry.set(row.entry_id, []);
        fixedByEntry.get(row.entry_id).push({ id: row.team_id, name: row.team_name, logo: row.team_logo_url, rank: row.predicted_rank });
    });
    const predictionsByUserSeason = new Map();
    predictionRows.forEach((row) => {
        const key = `${row.season_year}:${row.user_id}`;
        if (!predictionsByUserSeason.has(key)) predictionsByUserSeason.set(key, new Map());
        predictionsByUserSeason.get(key).set(row.match_id, row);
    });

    const tables = new Map(); // year -> actual table, only seasons that have one
    seasons.forEach((s) => {
        const table = tableOf(s.season_year);
        if (table.length) tables.set(s.season_year, table);
    });

    // one line per real account, or per unclaimed guest (a merged guest is already the account)
    const byKey = new Map();
    entries.forEach((entry) => {
        const table = tables.get(entry.season_year);
        if (!table) return;
        const predicted = entry.entry_mode === 'fixed_rank'
            ? fixedByEntry.get(entry.id) || []
            : computeUserPredictedStandings(matchesByYear.get(entry.season_year) || [], predictionsByUserSeason.get(`${entry.season_year}:${entry.user_id}`) || new Map());
        if (!predicted.length) return;
        const { total, bangOn } = computeOffsets(predicted, table);

        const profile = entry.user_id ? profiles.get(entry.user_id) : null;
        const key = entry.user_id ? `u:${entry.user_id}` : `g:${entry.guest_key}`;
        if (!byKey.has(key)) {
            byKey.set(key, {
                key,
                name: (profile && profile.display_name) || entry.guest_display_name || 'Unknown',
                color: entry.user_id ? profile?.chart_color : entry.guest_color, // stable palette index (0-11)
                isSelf: Boolean(selfId && entry.user_id === selfId),
                // how long this person has been around: their account, or their earliest entry
                since: (profile && profile.created_at) || null,
                points: [],
            });
        }
        const person = byKey.get(key);
        if (!person.since || (entry.submitted_at && entry.submitted_at < person.since)) person.since = entry.submitted_at || person.since;
        person.points.push({
            year: entry.season_year,
            score: total,
            bangOn,
            late: entry.is_late ? entry.late_weeks : 0,
            live: statusByYear.get(entry.season_year) !== 'concluded', // still being played: the score can still move
        });
    });

    const series = [...byKey.values()];
    series.forEach((s) => s.points.sort((a, b) => a.year - b.year));
    // Legend order: whoever has entries from the earliest season first; ties by who has been
    // around longest, then by name.
    series.sort((a, b) =>
        (a.points[0].year - b.points[0].year)
        || String(a.since || '').localeCompare(String(b.since || ''))
        || a.name.localeCompare(b.name));
    if (!series.length) return { seasons: [], series: [] };

    // Columns: with everyone shown, only seasons where somebody has a visible entry; for a single
    // account, from their first season to the latest one that has a table (so gaps show).
    const yearsWithPoints = new Set(series.flatMap((s) => s.points.map((p) => p.year)));
    const firstYear = Math.min(...yearsWithPoints);
    const axisYears = onlyUserId
        ? [...tables.keys()].filter((year) => year >= firstYear)
        : [...tables.keys()].filter((year) => yearsWithPoints.has(year));

    return {
        seasons: axisYears.sort((a, b) => a - b).map((year) => ({
            year,
            label: seasonLabel(year),
            live: statusByYear.get(year) !== 'concluded',
        })),
        series,
    };
}

// Everyone's history in one competition, for the leaderboard's History view.
export function loadCompetitionHistory(comp, selfId = null) {
    return buildCompetitionHistory(comp, { selfId });
}

// The signed-in user's own history in every competition, for the Profile page:
// Map(comp -> { seasons, series: [one line] }).
export async function loadMyHistory(userId, comps) {
    const out = new Map();
    await Promise.all(comps.map(async (comp) => {
        const history = await buildCompetitionHistory(comp, { onlyUserId: userId, selfId: userId });
        history.series.forEach((s) => { s.name = 'You'; });
        out.set(comp, history);
    }));
    return out;
}
