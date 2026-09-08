// Object to store team information
let teamsData = {};

let notificationTimeout; // Variable to store the timeout ID for the notification

let currentComp = 'ucl'; // Default competition

const colorSchemes = {
    ucl: {
        background: '#000040',
        nav: '#0230f7',         // copy button background, notification
        top8: '#17177a',
        match: '#0a0a61',       // comp/copy button hover, top 24, input background
        score: '#00eeff',
        finished: '#606098',
        icon: 'assets/ucl.ico',
        name: 'Champions'
    },
    uel: {
        background: 'black',
        nav: 'black',
        top8: '#3a3a3c',
        match: '#1c1c1e',
        score: '#ff6900',
        finished: '#555556',
        icon: 'assets/uel.ico',
        name: 'Europa'
    },
    uecl: {
        background: 'black',
        nav: 'black',
        top8: '#3a3a3c',
        match: '#1c1c1e',
        score: '#00be14',
        finished: '#555556',
        icon: 'assets/uecl.ico',
        name: 'Conference'
    }
};

// Functions to persist and restore predictions in localStorage, keyed per competition
function getPredictionsStorageKey(comp) {
    return `predictions_${comp}`;
}

function loadPredictions(comp) {
    try {
        const raw = localStorage.getItem(getPredictionsStorageKey(comp));
        return raw ? JSON.parse(raw) : {};
    } catch (err) {
        console.error('Failed to load saved predictions:', err);
        return {};
    }
}

function savePrediction(comp, matchId, homeScore, awayScore) {
    try {
        homeScore = homeScore.replace(/[^0-9]/g, '');
        awayScore = awayScore.replace(/[^0-9]/g, '');
        const predictions = loadPredictions(comp);
        if (homeScore === '' && awayScore === '') {
            delete predictions[matchId];
        } else {
            predictions[matchId] = { home: homeScore, away: awayScore };
        }
        localStorage.setItem(getPredictionsStorageKey(comp), JSON.stringify(predictions));
    } catch (err) {
        console.error('Failed to save prediction:', err);
    }
}

// Fetch matches from the backend and display them
async function fetchMatches(comp) {
    // Show loading indicator and hide matches container
    document.getElementById('loading-indicator').style.display = 'block';
    document.getElementById('matches').style.display = 'none';
    document.getElementById('league-table').style.display = 'none';

    currentComp = comp; // Update the current competition

    updateColorScheme(); // Update the color scheme based on the competition

    teamsData = {}; // Reset teamsData object when fetching new matches
    const savedPredictions = loadPredictions(comp); // Restore any previously saved predictions
    const response = await fetch('/api/matches/' + comp);
    const matches = await response.json();
    const matchesDiv = document.getElementById('matches');
    matchesDiv.innerHTML = '';  // Clear previous matches

    let currentMatchday = 0;
    let matchdayDiv = null; // Initialize outside the loop

    matches.forEach(match => {
        if (match.matchday.sequenceNumber !== currentMatchday) {
            currentMatchday = match.matchday.sequenceNumber;
            
            // Create a new matchday header and div for matches when matchday changes
            matchdayDiv = document.createElement('div'); // Create a new matchday div
            matchdayDiv.classList.add('matchday');
            matchesDiv.appendChild(matchdayDiv);
            
            // Create a header for the matchday
            const matchdayHeader = document.createElement('h2');
            matchdayHeader.textContent = `Matchday ${currentMatchday}`;
            matchdayDiv.appendChild(matchdayHeader);
            
            // Create a container for the matches
            const matchesContainer = document.createElement('div');
            matchesContainer.classList.add('matches');
            matchdayDiv.appendChild(matchesContainer);
        }

        if (matchdayDiv) { // Ensure matchdayDiv is defined
            const homeTeamId = match.homeTeam.id;
            const awayTeamId = match.awayTeam.id;
            const homeTeamName = match.homeTeam.internationalName;
            const homeTeamLogo = match.homeTeam.logoUrl;
            const awayTeamName = match.awayTeam.internationalName;
            const awayTeamLogo = match.awayTeam.logoUrl;

            // Initialize teams in the teamsData object if not already present
            if (!teamsData[homeTeamId]) {
                teamsData[homeTeamId] = { name: homeTeamName, wins: 0, draws: 0, losses: 0, goalsFor: 0, goalsAgainst: 0, points: 0, matches: {}, logo: homeTeamLogo, awayGoals: 0, awayWins: 0, awayMatches: {}, opponents: [], opponentsPoints: 0, opponentsGoalDifference: 0, opponentsGoalsFor: 0 };
            }
            if (!teamsData[awayTeamId]) {
                teamsData[awayTeamId] = { name: awayTeamName, wins: 0, draws: 0, losses: 0, goalsFor: 0, goalsAgainst: 0, points: 0, matches: {}, logo: awayTeamLogo, awayGoals: 0, awayWins: 0, awayMatches: {}, opponents: [], opponentsPoints: 0, opponentsGoalDifference: 0, opponentsGoalsFor: 0 };
            }

            let homeGoals = 0;
            let awayGoals = 0;
            let disabled = '';
            let homeResult = 'placeholder="0"';
            let awayResult = 'placeholder="0"';
            let inputClass = 'score-input';

            // Check if match has happened
            if (match.status === 'FINISHED') {
                homeGoals = match.score.total.home;
                awayGoals = match.score.total.away;
                disabled = 'disabled';
                homeResult = `value="${homeGoals}"`;
                awayResult = `value="${awayGoals}"`;
                inputClass = 'score-input-finished';
            } else {
                // Restore a saved prediction for this match, if one exists
                const saved = savedPredictions[match.id];
                if (saved) {
                    homeResult = `value="${saved.home}"`;
                    awayResult = `value="${saved.away}"`;
                }
            }

            teamsData[homeTeamId].matches[match.id] = { gf: homeGoals, ga: awayGoals };
            teamsData[awayTeamId].matches[match.id] = { gf: homeGoals, ga: awayGoals };
            teamsData[awayTeamId].awayMatches[match.id] = { gf: homeGoals, ga: awayGoals };
            teamsData[homeTeamId].opponents.push(awayTeamId);
            teamsData[awayTeamId].opponents.push(homeTeamId);

            // Create the match element
            const matchDiv = document.createElement('div');
            matchDiv.classList.add('match');

            matchDiv.innerHTML = `
                <div class="home">
                    <img src="${homeTeamLogo}" alt="${homeTeamName} logo">
                    <span>${homeTeamName}</span>
                    <input type="text" pattern="\\d*" id="home-${match.id}" class="${inputClass}" ${disabled} ${homeResult} maxlength="2" />
                </div>
                <div class="away">
                    <input type="text" pattern="\\d*" id="away-${match.id}" class="${inputClass}" ${disabled} ${awayResult} maxlength="2" />
                    <span>${awayTeamName}</span>
                    <img src="${awayTeamLogo}" alt="${awayTeamName} logo">
                </div>
            `;

            // Append the match to the matches container
            matchdayDiv.querySelector('.matches').appendChild(matchDiv);  

            // Add event listeners to update team data when scores change
            const homeInput = document.getElementById(`home-${match.id}`);
            const awayInput = document.getElementById(`away-${match.id}`);

            // Add input event listeners for updating match results and saving predictions
            homeInput.addEventListener('input', () => {
                updateTeamStats(match.id, homeTeamId, awayTeamId);
                savePrediction(comp, match.id, homeInput.value, awayInput.value);
            });
            awayInput.addEventListener('input', () => {
                updateTeamStats(match.id, homeTeamId, awayTeamId);
                savePrediction(comp, match.id, homeInput.value, awayInput.value);
            });

            // Add keydown event listeners for handling arrow keys movement
            homeInput.addEventListener('keydown', handleScoreInputKeydown);
            awayInput.addEventListener('keydown', handleScoreInputKeydown);

            updateTeamStats(match.id, homeTeamId, awayTeamId);
        }
    });

    // Hide loading indicator and show matches container
    document.getElementById('loading-indicator').style.display = 'none';
    document.getElementById('matches').style.display = 'block';
    document.getElementById('league-table').style.display = 'block';
}

// Function to update the color scheme
function updateColorScheme() {
    const colors = colorSchemes[currentComp] || colorSchemes.ucl; // Default to ucl if comp is not found
    
    // Apply color scheme to the body
    document.body.style.backgroundColor = colors.background;
    
    // Apply color scheme to navigation bar
    const navBar = document.querySelector('nav');
    navBar.style.backgroundColor = colors.nav;

    // Apply color scheme to top 8 teams
    const top8Rows = document.querySelectorAll('.top-8');
    top8Rows.forEach(row => {
        row.style.backgroundColor = colors.top8;
    });

    // Apply color scheme to top 24 teams
    const top24Rows = document.querySelectorAll('.top-24');
    top24Rows.forEach(row => {
        row.style.backgroundColor = colors.match;
    });

    // Apply color scheme to matches
    const matches = document.querySelectorAll('.match');
    matches.forEach(match => {
        match.style.backgroundColor = colors.match;
    });

    // Apply color scheme to score inputs
    const scoreInputs = document.querySelectorAll('input[type="text"] , input[type="number"]');
    scoreInputs.forEach(input => {
        input.style.backgroundColor = colors.match;
        input.style.borderColor = colors.score;
    });

    // Apply color scheme to score inputs from finished matches
    const finishedScoreInputs = document.querySelectorAll('.score-input-finished');
    finishedScoreInputs.forEach(input => {
        input.style.borderColor = colors.finished;
    });

    // Apply color scheme to competition buttons
    const compButtons = document.querySelectorAll('.comp-button');
    compButtons.forEach(button => {
        button.style.backgroundColor = colors.nav;
        button.addEventListener('mouseover', () => {
            button.style.backgroundColor = colors.match;
        });
        button.addEventListener('mouseout', () => {
            button.style.backgroundColor = colors.nav;
        });
    });

    // Apply color scheme to copy standings button
    const copyStandingsButton = document.getElementById('copy-standings');
    copyStandingsButton.style.backgroundColor = colors.nav;
    copyStandingsButton.addEventListener('mouseover', () => {
        copyStandingsButton.style.backgroundColor = colors.match;
    });
    copyStandingsButton.addEventListener('mouseout', () => {
        copyStandingsButton.style.backgroundColor = colors.nav;
    });

    // Apply color scheme to notification
    const notification = document.getElementById('notification');
    notification.style.backgroundColor = colors.nav;

    // Update the favicon
    const favicon = document.querySelector('link[rel="icon"]');
    favicon.href = colors.icon;

    // Update the header
    const header = document.getElementById('header');
    header.textContent = `UEFA ${colors.name} League Predictions`;

    // Update the title
    document.title = `UEFA ${colors.name} League Predictions`;

}

// Function to update team stats based on score input
function updateTeamStats(matchId, homeTeamId, awayTeamId) {
    const homeScore = parseInt(document.getElementById(`home-${matchId}`).value) || 0;
    const awayScore = parseInt(document.getElementById(`away-${matchId}`).value) || 0;

    // Update match data
    teamsData[homeTeamId].matches[matchId].gf = homeScore;
    teamsData[homeTeamId].matches[matchId].ga = awayScore;
    teamsData[awayTeamId].matches[matchId].gf = awayScore;
    teamsData[awayTeamId].matches[matchId].ga = homeScore;
    teamsData[awayTeamId].awayMatches[matchId].gf = awayScore;
    teamsData[awayTeamId].awayMatches[matchId].ga = homeScore;

    // Reset data (will be recalculated below)
    teamsData[homeTeamId].goalsFor = 0;
    teamsData[homeTeamId].goalsAgainst = 0;
    teamsData[homeTeamId].wins = 0;
    teamsData[homeTeamId].draws = 0;
    teamsData[homeTeamId].losses = 0;
    teamsData[homeTeamId].awayGoals = 0;
    teamsData[homeTeamId].awayWins = 0;
    teamsData[awayTeamId].goalsFor = 0;
    teamsData[awayTeamId].goalsAgainst = 0;
    teamsData[awayTeamId].wins = 0;
    teamsData[awayTeamId].draws = 0;
    teamsData[awayTeamId].losses = 0;
    teamsData[awayTeamId].awayGoals = 0;
    teamsData[awayTeamId].awayWins = 0;

    // Home team stats
    for (const homeTeamMatch of Object.values(teamsData[homeTeamId].matches)) {
        teamsData[homeTeamId].goalsFor += homeTeamMatch.gf;
        teamsData[homeTeamId].goalsAgainst += homeTeamMatch.ga;
        if (homeTeamMatch.gf > homeTeamMatch.ga) {
            teamsData[homeTeamId].wins++;
        } else if (homeTeamMatch.gf < homeTeamMatch.ga) {
            teamsData[homeTeamId].losses++;
        } else {
            teamsData[homeTeamId].draws++;
        }
    }
    teamsData[homeTeamId].points = teamsData[homeTeamId].wins * 3 + teamsData[homeTeamId].draws;
    for (const homeTeamAwayMatch of Object.values(teamsData[homeTeamId].awayMatches)) {
        teamsData[homeTeamId].awayGoals += homeTeamAwayMatch.gf;
        if (homeTeamAwayMatch.gf > homeTeamAwayMatch.ga) {
            teamsData[homeTeamId].awayWins++;
        }
    }

    // Away team stats
    for (const awayTeamMatch of Object.values(teamsData[awayTeamId].matches)) {
        teamsData[awayTeamId].goalsFor += awayTeamMatch.gf;
        teamsData[awayTeamId].goalsAgainst += awayTeamMatch.ga;
        if (awayTeamMatch.gf > awayTeamMatch.ga) {
            teamsData[awayTeamId].wins++;
        } else if (awayTeamMatch.gf < awayTeamMatch.ga) {
            teamsData[awayTeamId].losses++;
        } else {
            teamsData[awayTeamId].draws++;
        }
    }
    teamsData[awayTeamId].points = teamsData[awayTeamId].wins * 3 + teamsData[awayTeamId].draws;
    for (const awayTeamAwayMatch of Object.values(teamsData[awayTeamId].awayMatches)) {
        teamsData[awayTeamId].awayGoals += awayTeamAwayMatch.gf;
        if (awayTeamAwayMatch.gf > awayTeamAwayMatch.ga) {
            teamsData[awayTeamId].awayWins++;
        }
    }

    // Update opponents data for other teams
    updateOpponentsDataAgainst(homeTeamId);
    updateOpponentsDataAgainst(awayTeamId);

    // Update the league table display
    updateLeagueTable();
}

// Function to update opponents data for the teams that play against said team
function updateOpponentsDataAgainst(teamId) {
    const opponents = teamsData[teamId].opponents;
    opponents.forEach(opponentId => {
        updateOpponentsData(opponentId);
    });
}

// Function to update opponents data for a team
function updateOpponentsData(teamId) {
    const team = teamsData[teamId];
    team.opponentsPoints = 0;
    team.opponentsGoalDifference = 0;
    team.opponentsGoalsFor = 0;

    team.opponents.forEach(opponentId => {
        const opponent = teamsData[opponentId];
        team.opponentsPoints += opponent.points;
        team.opponentsGoalDifference += opponent.goalsFor - opponent.goalsAgainst;
        team.opponentsGoalsFor += opponent.goalsFor;
    });
}

// Function to update the league table display
function updateLeagueTable() {
    const tableBody = document.querySelector('#league-table tbody');
    tableBody.innerHTML = '';  // Clear current table

    // Convert teamsData object to an array for sorting
    const teamsArray = Object.keys(teamsData).map(teamId => ({
        name: teamsData[teamId].name,
        ...teamsData[teamId]
    }));

    // Sort teams according to "Article 18 Equality of points – league phase" of the regulations of the UEFA Champions League
    // And yes, alphabetical order is not one of the criteria but here it is for the sake of organization
    teamsArray.sort((a, b) => {
        // Sort by points
        if (b.points !== a.points) return b.points - a.points;
        
        // Sort by goal difference (goalsFor - goalsAgainst)
        const goalDifferenceB = b.goalsFor - b.goalsAgainst;
        const goalDifferenceA = a.goalsFor - a.goalsAgainst;
        if (goalDifferenceB !== goalDifferenceA) return goalDifferenceB - goalDifferenceA;
        
        // Sort by goals scored
        if (b.goalsFor !== a.goalsFor) return b.goalsFor - a.goalsFor;

        // Sort by away goals 
        if (b.awayGoals !== a.awayGoals) return b.awayGoals - a.awayGoals;

        // Sort by wins
        if (b.wins !== a.wins) return b.wins - a.wins;

        // Sort by away wins
        if (b.awayWins !== a.awayWins) return b.awayWins - a.awayWins;

        // Sort by opponents points
        if (b.opponentsPoints !== a.opponentsPoints) return b.opponentsPoints - a.opponentsPoints;

        // Sort by opponents goal difference
        if (b.opponentsGoalDifference !== a.opponentsGoalDifference) return b.opponentsGoalDifference - a.opponentsGoalDifference;

        // Sort by opponents goals for
        if (b.opponentsGoalsFor !== a.opponentsGoalsFor) return b.opponentsGoalsFor - a.opponentsGoalsFor;

        // Here would be the sort by disciplinary points (lower is better)

        // Here would be the sort by coefficient
        
        // Sort alphabetically
        return a.name.localeCompare(b.name);
    });

    // Populate the table with sorted teams
    teamsArray.forEach((team, index) => {
        const row = document.createElement('tr');
        // Add 'top-8' class to the first 8 teams
        if (index < 8) {
            row.classList.add('top-8');
        }
        // Add 'top-24' class to the first 24 teams
        else if (index < 24) {
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

    // Update the color scheme because the default is from the Champions League
    updateColorScheme();
}

// Function to get the team names and format them for copying
function getTeamNames() {
    const tableRows = document.querySelectorAll('#league-table tbody tr');
    let teamNames = '';

    tableRows.forEach(row => {
        const teamNameCell = row.querySelector('td:nth-child(3)'); // Third column is the team name
        if (teamNameCell) {
            teamNames += teamNameCell.textContent.trim() + '\n';
        }
    });

    return teamNames.trim(); // Remove the trailing newline
}

// Function to copy the standings to the clipboard
function copyStandingsToClipboard() {
    const teamNames = getTeamNames();
    navigator.clipboard.writeText(teamNames).then(() => {
        showNotification('Standings copied to clipboard!');
    }).catch(err => {
        console.error('Failed to copy: ', err);
    });
}

// Function to show a notification message
function showNotification(message) {
    const notification = document.getElementById('notification');
    notification.textContent = message;
    notification.style.display = 'block';

    // Clear any existing timeout
    if (notificationTimeout) {
        clearTimeout(notificationTimeout);
    }

    // Hide the notification after 3 seconds
    notificationTimeout = setTimeout(() => {
        notification.style.display = 'none';
    }, 3000);
}

// Function to handle keydown events for score inputs
function handleScoreInputKeydown(event) {
    const input = event.target;
    const key = event.key;

    // Handle Arrow keys only
    if (['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(key)) {
        const caretPosition = input.selectionStart;
        const inputValueLength = input.value.length;

        if (key === 'ArrowLeft') {
            // Move focus to previous input if caret is at the beginning
            if (caretPosition === 0) {
                moveFocus(input, -1);
            }
        } else if (key === 'ArrowRight') {
            // Move focus to next input if caret is at the end
            if (caretPosition === inputValueLength) {
                moveFocus(input, 1);
            }
        } else if (key === 'ArrowUp') {
            // Move focus to the input above if caret is at the beginning
            if (caretPosition === 0) {
                moveFocus(input, -4);
                event.preventDefault();  // Prevent default behavior
            }
        } else if (key === 'ArrowDown') {
            // Move focus to the input below if caret is at the end
            if (caretPosition === inputValueLength) {
                moveFocus(input, 4);
                event.preventDefault();  // Prevent default behavior
            }
        }
    }
}

// Function to move focus to the next or previous input
function moveFocus(currentInput, direction) {
    // Get all score inputs
    const scoreInputs = Array.from(document.querySelectorAll('.score-input'));
    const currentIndex = scoreInputs.indexOf(currentInput);
    const newIndex = Math.max(0, Math.min(scoreInputs.length - 1, currentIndex + direction));

    // Move focus to the new input
    if (scoreInputs[newIndex]) {
        scoreInputs[newIndex].focus();
    }
}

// Add event listener for the copy standings button
document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('copy-standings').addEventListener('click', copyStandingsToClipboard);

    const compButtons = document.querySelectorAll('.comp-button');
    compButtons.forEach(button => {
        button.addEventListener('click', () => {
            const arg = button.getAttribute('data-arg');
            fetchMatches(arg);
        });
    });
});

// Add event listener to prevent non-numeric input in score inputs
document.addEventListener('input', function (event) {
    const input = event.target;
    if (input.classList.contains('score-input')) {
        input.value = input.value.replace(/[^0-9]/g, ''); // Only allow digits
    }
});

// What to do when the window loads
window.onload = () => {
    // Show loading indicator and hide matches container
    document.getElementById('loading-indicator').style.display = 'block';
    document.getElementById('matches').style.display = 'none';

    // Fetch matches for the default competition
    fetchMatches('ucl');

    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/sw.js');
    }
};
