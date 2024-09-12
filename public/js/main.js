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
        icon: 'assets/ucl.ico',
        name: 'Champions'
    },
    uel: {
        background: 'black',
        nav: 'black',
        top8: '#3a3a3c',
        match: '#1c1c1e',
        score: '#ff6900',
        icon: 'assets/uel.ico',
        name: 'Europa'
    },
    uecl: {
        background: 'black',
        nav: 'black',
        top8: '#3a3a3c',
        match: '#1c1c1e',
        score: '#00be14',
        icon: 'assets/uecl.ico',
        name: 'Conference'
    }
};

// Fetch matches from the backend and display them
async function fetchMatches(comp) {
    // Show loading indicator and hide matches container
    document.getElementById('loading-indicator').style.display = 'block';
    document.getElementById('matches').style.display = 'none';
    document.getElementById('league-table').style.display = 'none';

    currentComp = comp; // Update the current competition

    updateColorScheme(); // Update the color scheme based on the competition

    teamsData = {}; // Reset teamsData object when fetching new matches
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
            
            const matchdayHeader = document.createElement('h2');
            matchdayHeader.textContent = `Matchday ${currentMatchday}`;
            matchdayDiv.appendChild(matchdayHeader);
            
            // Create a container for the matches
            const matchesContainer = document.createElement('div');
            matchesContainer.classList.add('matches');
            matchdayDiv.appendChild(matchesContainer);
        }

        if (matchdayDiv) { // Ensure matchdayDiv is defined
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

            // Create the match element
            const matchDiv = document.createElement('div');
            matchDiv.classList.add('match');

            matchDiv.innerHTML = `
                <div class="home">
                    <img src="${homeTeamLogo}" alt="${homeTeamName} logo">
                    <span>${homeTeamName}</span>
                    <input type="text" pattern="\\d*" id="home-${match.id}" class="score-input" placeholder="0" maxlength="2" />
                </div>
                <div class="away">
                    <input type="text" pattern="\\d*" id="away-${match.id}" class="score-input" placeholder="0" maxlength="2" />
                    <span>${awayTeamName}</span>
                    <img src="${awayTeamLogo}" alt="${awayTeamName} logo">
                </div>
            `;

            // Append the match to the matches container
            matchdayDiv.querySelector('.matches').appendChild(matchDiv);  

            // Add event listeners to update team data when scores change
            const homeInput = document.getElementById(`home-${match.id}`);
            const awayInput = document.getElementById(`away-${match.id}`);

            homeInput.addEventListener('input', () => updateTeamStats(match.id, homeTeamName, awayTeamName));
            awayInput.addEventListener('input', () => updateTeamStats(match.id, homeTeamName, awayTeamName));

            // Add keydown event listeners for handling arrow keys
            homeInput.addEventListener('keydown', handleScoreInputKeydown);
            awayInput.addEventListener('keydown', handleScoreInputKeydown);

            updateTeamStats(match.id, homeTeamName, awayTeamName);
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

    updateColorScheme();
}

// Function to get the team names and format them for copying
function getTeamNames() {
    const tableRows = document.querySelectorAll('#league-table tbody tr');
    let teamNames = '';

    tableRows.forEach(row => {
        const teamNameCell = row.querySelector('td:nth-child(3)'); // Adjust the index based on your table structure
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

// Add event listener for the button
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

window.onload = () => {
    // Show loading indicator and hide matches container
    document.getElementById('loading-indicator').style.display = 'block';
    document.getElementById('matches').style.display = 'none';
    
    // Fetch matches for the default competition
    fetchMatches('ucl');
};
