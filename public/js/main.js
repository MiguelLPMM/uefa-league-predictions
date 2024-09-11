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

        const matchDiv = document.createElement('div');
        matchDiv.classList.add('match');

        matchDiv.innerHTML = `
            <div class="home">
                <img src="${homeTeamLogo}" alt="${homeTeamName} logo">
                <span>${homeTeamName}</span>
                <input type="number" id="home-${match.id}" placeholder="0" min="0">
            </div>
            <div class="away">
                <input type="number" id="away-${match.id}" placeholder="0" min="0">
                <span>${awayTeamName}</span>
                <img src="${awayTeamLogo}" alt="${awayTeamName} logo">
            </div>
        `;
        matchesDiv.appendChild(matchDiv);
    });
}

window.onload = fetchMatches;
