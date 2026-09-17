// Server-side (CommonJS) copy of public/js/standings.js's computeStandings().
// Kept as a deliberate, minimal duplication rather than a shared import: the
// browser file is an ES module served straight to the client with no build
// step, and this one runs inside a CommonJS Vercel function - there's no
// bundler in this project to unify them under. The algorithm is UEFA's fixed
// tie-break rule set and essentially never changes; if it ever does, update
// both files identically.
//
// Used by api/sync-matches.js to automatically compute a season's final
// table once every one of its matches is FINISHED - see the comment there.

function computeStandings(matches) {
    const teamsData = {};

    const ensureTeam = (team) => {
        if (!teamsData[team.id]) {
            teamsData[team.id] = {
                id: team.id,
                name: team.name,
                logo: team.logo,
                wins: 0,
                draws: 0,
                losses: 0,
                goalsFor: 0,
                goalsAgainst: 0,
                points: 0,
                matches: {},
                awayGoals: 0,
                awayWins: 0,
                awayMatches: {},
                opponents: [],
                opponentsPoints: 0,
                opponentsGoalDifference: 0,
                opponentsGoalsFor: 0,
            };
        }
        return teamsData[team.id];
    };

    matches.forEach((match) => {
        const home = ensureTeam(match.home);
        const away = ensureTeam(match.away);
        const gf = match.homeGoals;
        const ga = match.awayGoals;

        home.matches[match.id] = { gf, ga };
        away.matches[match.id] = { gf: ga, ga: gf };
        away.awayMatches[match.id] = { gf: ga, ga: gf };
        home.opponents.push(away.id);
        away.opponents.push(home.id);
    });

    Object.values(teamsData).forEach((team) => {
        team.goalsFor = 0;
        team.goalsAgainst = 0;
        team.wins = 0;
        team.draws = 0;
        team.losses = 0;
        team.awayGoals = 0;
        team.awayWins = 0;

        for (const m of Object.values(team.matches)) {
            team.goalsFor += m.gf;
            team.goalsAgainst += m.ga;
            if (m.gf > m.ga) team.wins++;
            else if (m.gf < m.ga) team.losses++;
            else team.draws++;
        }
        team.points = team.wins * 3 + team.draws;

        for (const m of Object.values(team.awayMatches)) {
            team.awayGoals += m.gf;
            if (m.gf > m.ga) team.awayWins++;
        }
    });

    Object.values(teamsData).forEach((team) => {
        team.opponentsPoints = 0;
        team.opponentsGoalDifference = 0;
        team.opponentsGoalsFor = 0;
        team.opponents.forEach((opponentId) => {
            const opponent = teamsData[opponentId];
            team.opponentsPoints += opponent.points;
            team.opponentsGoalDifference += opponent.goalsFor - opponent.goalsAgainst;
            team.opponentsGoalsFor += opponent.goalsFor;
        });
    });

    const teamsArray = Object.values(teamsData);

    teamsArray.sort((a, b) => {
        if (b.points !== a.points) return b.points - a.points;

        const goalDifferenceB = b.goalsFor - b.goalsAgainst;
        const goalDifferenceA = a.goalsFor - a.goalsAgainst;
        if (goalDifferenceB !== goalDifferenceA) return goalDifferenceB - goalDifferenceA;

        if (b.goalsFor !== a.goalsFor) return b.goalsFor - a.goalsFor;
        if (b.awayGoals !== a.awayGoals) return b.awayGoals - a.awayGoals;
        if (b.wins !== a.wins) return b.wins - a.wins;
        if (b.awayWins !== a.awayWins) return b.awayWins - a.awayWins;
        if (b.opponentsPoints !== a.opponentsPoints) return b.opponentsPoints - a.opponentsPoints;
        if (b.opponentsGoalDifference !== a.opponentsGoalDifference) return b.opponentsGoalDifference - a.opponentsGoalDifference;
        if (b.opponentsGoalsFor !== a.opponentsGoalsFor) return b.opponentsGoalsFor - a.opponentsGoalsFor;

        return a.name.localeCompare(b.name);
    });

    teamsArray.forEach((team, index) => {
        team.rank = index + 1;
    });

    return teamsArray;
}

module.exports = { computeStandings };
