// Object to store team information
let teamsData = {};

// Fetch matches from the backend and display them
async function fetchMatches() {
    const response = await fetch('/api/matches');
    const matches = await response.json();
    const matchesDiv = document.getElementById('matches');
    matchesDiv.innerHTML = '';  // Clear previous matches

    matches.forEach(match => {
        const homeTeamName = match.homeTeam.internationalName;
        const homeTeamLogo = match.homeTeam.logoUrl;
        const awayTeamName = match.awayTeam.internationalName;
        const awayTeamLogo = match.awayTeam.logoUrl;

        // Initialize teams in the teamsData object if not already present
        if (!teamsData[homeTeamName]) {
            teamsData[homeTeamName] = { wins: 0, draws: 0, losses: 0, goalsFor: 0, goalsAgainst: 0, points: 0, matches: {}, logo: homeTeamLogo };
        }
        if (!teamsData[awayTeamName]) {
            teamsData[awayTeamName] = { wins: 0, draws: 0, losses: 0, goalsFor: 0, goalsAgainst: 0, points: 0, matches: {}, logo: awayTeamLogo };
        }

        teamsData[homeTeamName].matches[match.id] = { gf: 0, ga: 0 };
        teamsData[awayTeamName].matches[match.id] = { gf: 0, ga: 0 };

        const matchDiv = document.createElement('div');
        matchDiv.classList.add('match');

        matchDiv.innerHTML = `
            <div class="home">
                <img src="${homeTeamLogo}" alt="${homeTeamName} logo">
                <span>${homeTeamName}</span>
                <input type="text" pattern="\d*" id="home-${match.id}" class="score-input" placeholder="0" maxlength="2" />
            </div>
            <div class="away">
                <input type="text" pattern="\d*" id="away-${match.id}" class="score-input" placeholder="0" maxlength="2" />
                <span>${awayTeamName}</span>
                <img src="${awayTeamLogo}" alt="${awayTeamName} logo">
            </div>
        `;
        matchesDiv.appendChild(matchDiv);

        // Add event listeners to update team data when scores change
        document.getElementById(`home-${match.id}`).addEventListener('input', () => updateTeamStats(match.id, homeTeamName, awayTeamName));
        document.getElementById(`away-${match.id}`).addEventListener('input', () => updateTeamStats(match.id, homeTeamName, awayTeamName));

        updateTeamStats(match.id, homeTeamName, awayTeamName);
    });
}

// Function to update team stats based on score input
function updateTeamStats(matchId, homeTeamName, awayTeamName) {
    const homeScore = parseInt(document.getElementById(`home-${matchId}`).value) || 0;
    const awayScore = parseInt(document.getElementById(`away-${matchId}`).value) || 0;

    teamsData[homeTeamName].matches[matchId].gf = homeScore;
    teamsData[homeTeamName].matches[matchId].ga = awayScore;
    teamsData[awayTeamName].matches[matchId].gf = awayScore;
    teamsData[awayTeamName].matches[matchId].ga = homeScore;

    // Reset data (will be recalculated below)
    teamsData[homeTeamName].goalsFor = 0;
    teamsData[homeTeamName].goalsAgainst = 0;
    teamsData[homeTeamName].wins = 0;
    teamsData[homeTeamName].draws = 0;
    teamsData[homeTeamName].losses = 0;
    teamsData[awayTeamName].goalsFor = 0;
    teamsData[awayTeamName].goalsAgainst = 0;
    teamsData[awayTeamName].wins = 0;
    teamsData[awayTeamName].draws = 0;
    teamsData[awayTeamName].losses = 0;

    for (const homeTeamMatch of Object.values(teamsData[homeTeamName].matches)) {
        teamsData[homeTeamName].goalsFor += homeTeamMatch.gf;
        teamsData[homeTeamName].goalsAgainst += homeTeamMatch.ga;
        if (homeTeamMatch.gf > homeTeamMatch.ga) {
            teamsData[homeTeamName].wins++;
        } else if (homeTeamMatch.gf < homeTeamMatch.ga) {
            teamsData[homeTeamName].losses++;
        } else {
            teamsData[homeTeamName].draws++;
        }
    }
    teamsData[homeTeamName].points = teamsData[homeTeamName].wins * 3 + teamsData[homeTeamName].draws;

    for (const awayTeamMatch of Object.values(teamsData[awayTeamName].matches)) {
        teamsData[awayTeamName].goalsFor += awayTeamMatch.gf;
        teamsData[awayTeamName].goalsAgainst += awayTeamMatch.ga;
        if (awayTeamMatch.gf > awayTeamMatch.ga) {
            teamsData[awayTeamName].wins++;
        } else if (awayTeamMatch.gf < awayTeamMatch.ga) {
            teamsData[awayTeamName].losses++;
        } else {
            teamsData[awayTeamName].draws++;
        }
    }
    teamsData[awayTeamName].points = teamsData[awayTeamName].wins * 3 + teamsData[awayTeamName].draws;

    // Now you can call a function to update the league table display
    updateLeagueTable();
}

// Function to update the league table display
function updateLeagueTable() {
    const tableBody = document.querySelector('#league-table tbody');
    tableBody.innerHTML = '';  // Clear current table

    // Convert teamsData object to an array for sorting
    const teamsArray = Object.keys(teamsData).map(teamName => ({
        name: teamName,
        ...teamsData[teamName]
    }));

    // Sort teams first by points, then by goal difference, then by goals for, and finally alphabetically
    teamsArray.sort((a, b) => {
        // Sort by points
        if (b.points !== a.points) return b.points - a.points;
        
        // Sort by goal difference (goalsFor - goalsAgainst)
        const goalDifferenceB = b.goalsFor - b.goalsAgainst;
        const goalDifferenceA = a.goalsFor - a.goalsAgainst;
        if (goalDifferenceB !== goalDifferenceA) return goalDifferenceB - goalDifferenceA;
        
        // Sort by goals for
        if (b.goalsFor !== a.goalsFor) return b.goalsFor - a.goalsFor;
        
        // Sort alphabetically
        return a.name.localeCompare(b.name);
    });

    // Populate the table with sorted teams
    teamsArray.forEach((team, index) => {
        const row = document.createElement('tr');
        // Add 'top-8' class to the first 8 teams
        if (index < 8) {
            row.classList.add('top-8');
        } else if (index < 24) {
            row.classList.add('top-24');
        }
        row.innerHTML = `
            <td>${teamsArray.indexOf(team) + 1}</td> <!-- Position column -->
            <td><img src="${team.logo}" alt="${team.name} logo" style="width: 30px; height: 30px;"></td> <!-- Logo column -->
            <td>${team.name}</td>
            <td>${team.wins}</td>
            <td>${team.draws}</td>
            <td>${team.losses}</td>
            <td>${team.goalsFor}</td>
            <td>${team.goalsAgainst}</td>
            <td>${team.goalsFor - team.goalsAgainst}</td>
            <td>${team.points}</td>
        `;
        tableBody.appendChild(row);
    });
}

window.onload = fetchMatches;
