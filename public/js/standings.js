// Pure standings computation, extracted so both the predicting page and the
// leaderboard pages can share one implementation instead of two drifting copies.
//
// Input: a plain array of matches, each shaped like
//   { id, home: { id, name, logo }, away: { id, name, logo }, homeGoals, awayGoals }
// Only matches passed in are aggregated — callers decide what counts:
//   - the predicting page passes every match (finished ones with real scores,
//     unplayed ones defaulted to the user's saved prediction or 0-0) to build
//     a full projected table as the user types;
//   - the live/actual leaderboard table must NOT do that — it should only ever
//     pass matches that have actually finished, so unplayed fixtures are simply
//     absent from the aggregation rather than counted as 0-0 draws.
//
// Output: an array of team stat objects, sorted best-to-worst, each with an
// explicit 1-based `rank`.

export function computeStandings(matches) {
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

    // Recompute each team's own stats from its accumulated match list.
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

    // Opponents' aggregate stats (used as an approximation of a strength-of-
    // schedule tiebreak) can only be computed once every team's own points/GD
    // are final, hence the second pass.
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

    // Sort teams according to "Article 18 Equality of points – league phase" of
    // the regulations of the UEFA Champions League.
    // And yes, alphabetical order is not one of the criteria but here it is for
    // the sake of organization.
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

        // Here would be the sort by disciplinary points (lower is better)
        // Here would be the sort by coefficient

        return a.name.localeCompare(b.name);
    });

    teamsArray.forEach((team, index) => {
        team.rank = index + 1;
    });

    return teamsArray;
}
