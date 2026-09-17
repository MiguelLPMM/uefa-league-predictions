// The drill-down modal: one user's full predicted table plus every
// individual match score they predicted. Reuses the exact same
// .matchday/.matches/.match/.home/.away card markup as the predicting page
// (public/js/main.js) for visual consistency - inputs are just disabled
// since this is someone else's read-only picks.

export function setupDrilldownModal() {
    const overlay = document.getElementById('drilldown-overlay');
    const closeButton = document.getElementById('drilldown-close');
    if (overlay) overlay.addEventListener('click', closeDrilldown);
    if (closeButton) closeButton.addEventListener('click', closeDrilldown);
}

export function closeDrilldown() {
    const overlay = document.getElementById('drilldown-overlay');
    const modal = document.getElementById('drilldown-modal');
    if (overlay) overlay.hidden = true;
    if (modal) modal.hidden = true;
}

// user: { displayName, avatarUrl, is_late, late_weeks }
// matchesCache: every matches_cache row for this competition+season, sorted
//   by matchday_seq
// predictionsByMatchId: Map(match_id -> { predicted_home, predicted_away })
//   for this one user
// predictedStandings: this user's computeStandings() output
// actualRankByTeamId: Map(team_id -> actual rank), missing an entry for a
//   team that hasn't played yet
export function openDrilldown(user, matchesCache, predictionsByMatchId, predictedStandings, actualRankByTeamId, colors) {
    renderHeader(user);
    renderStandingsTable(predictedStandings, actualRankByTeamId, colors);
    renderMatches(matchesCache, predictionsByMatchId, colors);

    document.getElementById('drilldown-overlay').hidden = false;
    document.getElementById('drilldown-modal').hidden = false;
}

function renderHeader(user) {
    const header = document.getElementById('drilldown-user');
    header.innerHTML = '';

    if (user.avatarUrl) {
        const avatar = document.createElement('img');
        avatar.src = user.avatarUrl;
        avatar.alt = '';
        header.appendChild(avatar);
    }

    const name = document.createElement('span');
    name.className = 'leaderboard-name';
    name.textContent = user.displayName;
    header.appendChild(name);

    if (user.is_late) {
        const badge = document.createElement('span');
        badge.className = 'leaderboard-late-badge';
        badge.textContent = `${user.late_weeks} week${user.late_weeks === 1 ? '' : 's'} late`;
        header.appendChild(badge);
    }
}

function renderStandingsTable(predictedStandings, actualRankByTeamId, colors) {
    const tbody = document.querySelector('#drilldown-standings-table tbody');
    tbody.innerHTML = '';

    predictedStandings.forEach((team) => {
        const tr = document.createElement('tr');
        tr.style.backgroundColor = team.rank <= 8 ? colors.top8 : team.rank <= 24 ? colors.match : colors.background;

        const rankCell = document.createElement('td');
        rankCell.textContent = String(team.rank);
        tr.appendChild(rankCell);

        const logoCell = document.createElement('td');
        const logo = document.createElement('img');
        logo.src = team.logo;
        logo.alt = '';
        logoCell.appendChild(logo);
        tr.appendChild(logoCell);

        const nameCell = document.createElement('td');
        nameCell.textContent = team.name;
        tr.appendChild(nameCell);

        const offCell = document.createElement('td');
        const actualRank = actualRankByTeamId.get(team.id);
        if (actualRank == null) {
            offCell.textContent = '—';
        } else {
            const off = team.rank - actualRank;
            offCell.textContent = off > 0 ? `+${off}` : String(off);
            if (off === 0) offCell.classList.add('off-bangon');
        }
        tr.appendChild(offCell);

        tbody.appendChild(tr);
    });
}

function buildScoreInput(value, finished, colors) {
    const input = document.createElement('input');
    input.type = 'text';
    input.disabled = true;
    input.value = value == null ? '' : String(value);
    if (finished) input.classList.add('score-input-finished');
    input.style.backgroundColor = colors.match;
    input.style.borderColor = finished ? colors.finished : colors.score;
    return input;
}

function renderMatches(matchesCache, predictionsByMatchId, colors) {
    const container = document.getElementById('drilldown-matches');
    container.innerHTML = '';

    let currentMatchday = null;
    let matchesGrid = null;

    matchesCache.forEach((row) => {
        if (row.matchday_seq !== currentMatchday) {
            currentMatchday = row.matchday_seq;
            const matchdayDiv = document.createElement('div');
            matchdayDiv.className = 'matchday';
            const header = document.createElement('h2');
            header.textContent = `Matchday ${currentMatchday}`;
            matchdayDiv.appendChild(header);
            matchesGrid = document.createElement('div');
            matchesGrid.className = 'matches';
            matchdayDiv.appendChild(matchesGrid);
            container.appendChild(matchdayDiv);
        }

        const finished = row.status === 'FINISHED';
        const prediction = predictionsByMatchId.get(row.id);
        const homeValue = finished ? row.home_score : (prediction ? prediction.predicted_home : null);
        const awayValue = finished ? row.away_score : (prediction ? prediction.predicted_away : null);

        const matchDiv = document.createElement('div');
        matchDiv.className = 'match';
        matchDiv.style.backgroundColor = colors.match;

        const homeDiv = document.createElement('div');
        homeDiv.className = 'home';
        const homeLogo = document.createElement('img');
        homeLogo.src = row.home_team_logo;
        homeLogo.alt = row.home_team_name;
        homeDiv.append(homeLogo, buildScoreInput(homeValue, finished, colors));

        const awayDiv = document.createElement('div');
        awayDiv.className = 'away';
        const awayLogo = document.createElement('img');
        awayLogo.src = row.away_team_logo;
        awayLogo.alt = row.away_team_name;
        awayDiv.append(buildScoreInput(awayValue, finished, colors), awayLogo);

        matchDiv.append(homeDiv, awayDiv);
        matchesGrid.appendChild(matchDiv);
    });

    if (matchesCache.length === 0) {
        const empty = document.createElement('p');
        empty.textContent = 'No matches yet.';
        container.appendChild(empty);
    }
}
