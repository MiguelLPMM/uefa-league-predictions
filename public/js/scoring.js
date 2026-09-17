// Off-by/bang-on scoring, shared by every leaderboard view. Builds on top of
// standings.js's computeStandings() rather than duplicating any ranking
// logic — this module only ever compares two already-ranked team arrays.
import { computeStandings } from './standings.js';

// Converts one matches_cache row into the plain match shape computeStandings()
// expects.
function toStandingsMatch(row, homeGoals, awayGoals) {
    return {
        id: row.id,
        home: { id: row.home_team_id, name: row.home_team_name, logo: row.home_team_logo },
        away: { id: row.away_team_id, name: row.away_team_name, logo: row.away_team_logo },
        homeGoals,
        awayGoals,
    };
}

// The real/live actual standings: only matches that have actually finished
// count, so a team with zero games played is simply absent rather than
// counted as a 0-0-drawn team (see the project plan for why).
export function computeActualStandings(matchesCacheRows) {
    const finished = matchesCacheRows.filter((row) => row.status === 'FINISHED');
    return computeStandings(finished.map((row) => toStandingsMatch(row, row.home_score, row.away_score)));
}

// One user's projected final standings: finished matches always use the real
// score, unplayed matches use that user's saved prediction for that match if
// they have one. A match the user never predicted is left out entirely
// (same "excluded, not defaulted" convention as computeStandings() itself),
// so that team just won't be scoreable against yet for this user.
export function computeUserPredictedStandings(matchesCacheRows, predictionsByMatchId) {
    const matches = [];
    matchesCacheRows.forEach((row) => {
        if (row.status === 'FINISHED') {
            matches.push(toStandingsMatch(row, row.home_score, row.away_score));
            return;
        }
        const prediction = predictionsByMatchId.get(row.id);
        if (!prediction) return;
        matches.push(toStandingsMatch(row, prediction.predicted_home, prediction.predicted_away));
    });
    return computeStandings(matches);
}

// Compares a user's predicted standings against the actual ones: for every
// team that has an actual rank, off = predicted_rank - actual_rank (0 =
// "bang on"). Teams the user hasn't predicted yet just don't contribute.
// Returns the per-team offsets (keyed by team id) plus the total |off| sum
// and bang-on count used for ranking/tie-breaking.
export function computeOffsets(predictedStandings, actualStandings) {
    const predictedRankByTeam = new Map(predictedStandings.map((team) => [team.id, team.rank]));
    const offsetByTeamId = new Map();
    let total = 0;
    let bangOn = 0;

    actualStandings.forEach((actualTeam) => {
        const predictedRank = predictedRankByTeam.get(actualTeam.id);
        if (predictedRank == null) return;
        const off = predictedRank - actualTeam.rank;
        offsetByTeamId.set(actualTeam.id, off);
        total += Math.abs(off);
        if (off === 0) bangOn++;
    });

    return { offsetByTeamId, total, bangOn };
}
