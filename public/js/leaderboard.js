// Entry script for leaderboard.html: shared chrome (theme, competition
// switcher, hamburger sidebar/auth) plus the two leaderboard views built in
// this phase — the live ranked list (view 3) and the actual-table lateral-
// scroll view (view 2). The per-user breakdown view (view 1), favorites and
// the self/submission-time column ordering are a later phase; for now every
// entry appears in plain submission-time order.
import { applySharedTheme, getColors } from './theme.js';
import { syncUrlToSelectedComp, wireCompButtons } from './compSelector.js';
import { setupNav } from './nav.js';
import { getCurrentCompetitionSeason, getMatchesCache, getEntriesWithProfiles, getAllPredictions } from './api/leaderboard.js';
import { computeActualStandings, computeUserPredictedStandings, computeOffsets } from './scoring.js';

const VIEW_STORAGE_KEY = 'leaderboardView';
const VALID_VIEWS = ['live', 'table'];

function getSelectedView() {
    try {
        const stored = localStorage.getItem(VIEW_STORAGE_KEY);
        if (VALID_VIEWS.includes(stored)) return stored;
    } catch (err) {
        // Fall through to the default.
    }
    return 'live';
}

function setSelectedView(view) {
    try {
        localStorage.setItem(VIEW_STORAGE_KEY, view);
    } catch (err) {
        // Not worth failing over - worst case the choice doesn't persist.
    }
    document.getElementById('leaderboard-live').hidden = view !== 'live';
    document.getElementById('leaderboard-table').hidden = view !== 'table';
    document.querySelectorAll('.view-tab').forEach((tab) => {
        tab.classList.toggle('active', tab.dataset.view === view);
    });
}

function showGate(message) {
    document.getElementById('leaderboard-gate-message').textContent = message;
    document.getElementById('leaderboard-gate').hidden = false;
    document.getElementById('leaderboard-content').hidden = true;
}

function renderLiveView(results) {
    const container = document.getElementById('leaderboard-live');
    container.innerHTML = '';

    results.forEach((result, index) => {
        const row = document.createElement('div');
        row.className = 'leaderboard-row';

        const rank = document.createElement('span');
        rank.className = 'leaderboard-rank';
        rank.textContent = String(index + 1);
        row.appendChild(rank);

        const user = document.createElement('div');
        user.className = 'leaderboard-user';
        if (result.entry.avatarUrl) {
            const avatar = document.createElement('img');
            avatar.src = result.entry.avatarUrl;
            avatar.alt = '';
            user.appendChild(avatar);
        }
        const name = document.createElement('span');
        name.className = 'leaderboard-name';
        name.textContent = result.entry.displayName;
        user.appendChild(name);
        if (result.entry.is_late) {
            const badge = document.createElement('span');
            badge.className = 'leaderboard-late-badge';
            const weeks = result.entry.late_weeks;
            badge.textContent = `${weeks} week${weeks === 1 ? '' : 's'} late`;
            user.appendChild(badge);
        }
        row.appendChild(user);

        const score = document.createElement('span');
        score.className = 'leaderboard-score';
        score.textContent = String(result.total);
        row.appendChild(score);

        const bangOn = document.createElement('span');
        bangOn.className = 'leaderboard-bangon';
        bangOn.textContent = `${result.bangOn} bang on`;
        row.appendChild(bangOn);

        container.appendChild(row);
    });
}

function renderTableView(actualStandings, results, colors) {
    const container = document.getElementById('leaderboard-table');
    container.innerHTML = '';

    const table = document.createElement('table');
    table.className = 'leaderboard-actual-table';

    const thead = document.createElement('thead');
    const headRow = document.createElement('tr');

    const cornerRank = document.createElement('th');
    cornerRank.className = 'frozen-col';
    cornerRank.style.backgroundColor = colors.nav;
    headRow.appendChild(cornerRank);

    const cornerTeam = document.createElement('th');
    cornerTeam.className = 'frozen-col team-col';
    cornerTeam.textContent = 'Team';
    cornerTeam.style.backgroundColor = colors.nav;
    headRow.appendChild(cornerTeam);

    results.forEach((result) => {
        const th = document.createElement('th');
        th.className = 'user-col';
        th.textContent = result.entry.displayName;
        th.style.backgroundColor = colors.nav;
        headRow.appendChild(th);
    });
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    actualStandings.forEach((team) => {
        const tierColor = team.rank <= 8 ? colors.top8 : team.rank <= 24 ? colors.match : colors.background;
        const tr = document.createElement('tr');

        const rankCell = document.createElement('td');
        rankCell.className = 'frozen-col';
        rankCell.textContent = String(team.rank);
        rankCell.style.backgroundColor = tierColor;
        tr.appendChild(rankCell);

        const teamCell = document.createElement('td');
        teamCell.className = 'frozen-col team-col';
        teamCell.style.backgroundColor = tierColor;
        const logo = document.createElement('img');
        logo.src = team.logo;
        logo.alt = '';
        const name = document.createElement('span');
        name.textContent = team.name;
        teamCell.append(logo, name);
        tr.appendChild(teamCell);

        results.forEach((result) => {
            const cell = document.createElement('td');
            cell.className = 'user-col';
            cell.style.backgroundColor = tierColor;
            const off = result.offsetByTeamId.get(team.id);
            if (off == null) {
                cell.textContent = '—';
            } else {
                cell.textContent = off > 0 ? `+${off}` : String(off);
                if (off === 0) cell.classList.add('off-bangon');
            }
            tr.appendChild(cell);
        });

        tbody.appendChild(tr);
    });
    table.appendChild(tbody);

    container.appendChild(table);
}

async function loadLeaderboard(comp) {
    document.getElementById('leaderboard-gate').hidden = true;
    document.getElementById('leaderboard-content').hidden = true;

    let compSeason;
    try {
        compSeason = await getCurrentCompetitionSeason(comp);
    } catch (err) {
        console.error('Failed to load competition season:', err);
        showGate('Failed to load the leaderboard — please try again later.');
        return;
    }

    if (!compSeason || !compSeason.reveal_unlocked) {
        showGate("The leaderboard for this competition unlocks once its first match kicks off.");
        return;
    }

    const seasonYear = compSeason.season_year;

    let matchesCache, entries, predictions;
    try {
        [matchesCache, entries, predictions] = await Promise.all([
            getMatchesCache(comp, seasonYear),
            getEntriesWithProfiles(comp, seasonYear),
            getAllPredictions(comp, seasonYear),
        ]);
    } catch (err) {
        console.error('Failed to load leaderboard data:', err);
        showGate('Failed to load the leaderboard — please try again later.');
        return;
    }

    // Fixed-rank entries (historical/imported seasons) are a later phase -
    // this view only knows how to score live match-prediction entries.
    const liveEntries = entries.filter((entry) => entry.entry_mode === 'live');
    if (liveEntries.length === 0) {
        showGate('No one has saved a prediction for this competition yet.');
        return;
    }

    const predictionsByUser = new Map();
    predictions.forEach((prediction) => {
        if (!predictionsByUser.has(prediction.user_id)) {
            predictionsByUser.set(prediction.user_id, new Map());
        }
        predictionsByUser.get(prediction.user_id).set(prediction.match_id, prediction);
    });

    const actualStandings = computeActualStandings(matchesCache);

    const results = liveEntries.map((entry) => {
        const predictedStandings = computeUserPredictedStandings(matchesCache, predictionsByUser.get(entry.user_id) || new Map());
        const { offsetByTeamId, total, bangOn } = computeOffsets(predictedStandings, actualStandings);
        return { entry, offsetByTeamId, total, bangOn };
    });

    results.sort((a, b) => (a.total - b.total) || (b.bangOn - a.bangOn));

    const colors = getColors(comp);
    renderLiveView(results);
    renderTableView(actualStandings, results, colors);

    document.getElementById('leaderboard-content').hidden = false;
}

document.addEventListener('DOMContentLoaded', () => {
    wireCompButtons();
    window.addEventListener('comp-changed', (event) => {
        applySharedTheme(event.detail.comp);
        loadLeaderboard(event.detail.comp);
    });

    document.querySelectorAll('.view-tab').forEach((tab) => {
        tab.addEventListener('click', () => setSelectedView(tab.dataset.view));
    });
    setSelectedView(getSelectedView());

    setupNav();

    const comp = syncUrlToSelectedComp();
    applySharedTheme(comp);
    loadLeaderboard(comp);

    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/sw.js');
    }
});
