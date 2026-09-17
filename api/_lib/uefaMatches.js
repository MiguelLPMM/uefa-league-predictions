// Shared by api/matches/[comp].js and api/sync-matches.js so both fetch UEFA
// data the same way instead of drifting apart.
const { getMatches } = require('uefa-api');

// Season variable updating each September. Left exactly as it was in
// api/matches/[comp].js — do not change this rollover logic here.
function getSeasonYear() {
    const currentDate = new Date();
    const currentYear = currentDate.getFullYear();
    return currentDate.getMonth() >= 8 ? currentYear + 1 : currentYear;
}

const COMPETITIONS = {
    ucl: { competitionId: 1, limit: 238, label: 'Champions League' },
    uel: { competitionId: 14, limit: 234, label: 'Europa League' },
    uecl: { competitionId: 2019, limit: 364, label: 'Conference League' },
};

// Fetches one competition's current-season league-phase matches.
async function fetchCompetitionMatches(compKey) {
    const competition = COMPETITIONS[compKey];
    if (!competition) {
        throw new Error(`Unknown competition: ${compKey}`);
    }
    const matches = await getMatches({
        competitionId: competition.competitionId,
        seasonYear: getSeasonYear(),
    }, 'ASC', competition.limit);

    return matches.filter(match => match.type === 'GROUP_STAGE');
}

module.exports = { getSeasonYear, COMPETITIONS, fetchCompetitionMatches };
