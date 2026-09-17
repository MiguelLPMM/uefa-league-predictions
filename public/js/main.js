import { computeStandings } from './standings.js';
import { applySharedTheme } from './theme.js';
import { getSelectedComp, syncUrlToSelectedComp, wireCompButtons, linkWithComp } from './compSelector.js';
import { setupNav } from './nav.js';
import { showNotification } from './notify.js';
import { getCurrentUser, onAuthStateChange } from './auth.js';
import { saveMatchPredictionsBatch, loadOfficialPredictions, getMyEntry, isDeadlinePassed } from './api/predictions.js';

let currentComp = getSelectedComp(); // Default competition

// The UEFA season year (e.g. 2027 for the 26/27 season) that the currently
// loaded matches belong to — read straight off the fetched match data
// (every match already carries its own seasonYear) rather than recomputing
// the same September-rollover rule client-side and risking it drifting from
// api/_lib/uefaMatches.js's getSeasonYear().
let currentSeasonYear = null;

// Lightweight per-match metadata for the currently loaded competition, used to
// rebuild the standings table from scratch on every score change. Real
// (FINISHED) results are fixed; everything else is read live from the score
// inputs each time the table re-renders.
let currentMatches = [];

// Captured once, before compSelector's own URL sync runs, so the
// default-landing-page redirect (see maybeRedirectToDefaultLandingPage) only
// ever applies to a genuinely bare visit (no query string at all) and never
// fights an explicit navigation, e.g. from the sidebar, which always carries
// its own ?comp=.
const initialQueryString = window.location.search;
let hasCheckedDefaultLanding = false;

// Once the season is underway, index.html isn't the useful default landing
// page anymore — send a bare/fresh visit straight to the leaderboard instead.
// Returns true if it triggered a redirect (caller should stop rendering).
function maybeRedirectToDefaultLandingPage(matches) {
    if (hasCheckedDefaultLanding) return false;
    hasCheckedDefaultLanding = true;
    if (initialQueryString !== '') return false; // explicit navigation - respect it
    const seasonUnderway = matches.some((m) => m.status === 'FINISHED');
    if (seasonUnderway) {
        window.location.replace(linkWithComp('leaderboard.html'));
        return true;
    }
    return false;
}

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

    currentMatches = []; // Reset match metadata when fetching new matches
    const savedPredictions = loadPredictions(comp); // Restore any previously saved predictions
    const response = await fetch('/api/matches/' + comp);
    const matches = await response.json();

    if (maybeRedirectToDefaultLandingPage(matches)) {
        return; // navigating away to the leaderboard, no point rendering this page
    }

    currentSeasonYear = matches.length > 0 ? Number(matches[0].seasonYear) : null;

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

            const finished = match.status === 'FINISHED';

            let disabled = '';
            let homeResult = 'placeholder="0"';
            let awayResult = 'placeholder="0"';
            let inputClass = 'score-input';

            // Check if match has happened
            if (finished) {
                disabled = 'disabled';
                homeResult = `value="${match.score.total.home}"`;
                awayResult = `value="${match.score.total.away}"`;
                inputClass = 'score-input-finished';
            } else {
                // Restore a saved prediction for this match, if one exists.
                // Each side is restored independently so a half-filled
                // prediction (e.g. only the home score typed so far) keeps
                // showing the greyed-out "0" placeholder on the untouched
                // side, instead of losing it to a blank value="".
                const saved = savedPredictions[match.id];
                if (saved && saved.home !== '') {
                    homeResult = `value="${saved.home}"`;
                }
                if (saved && saved.away !== '') {
                    awayResult = `value="${saved.away}"`;
                }
            }

            currentMatches.push({
                id: match.id,
                home: { id: homeTeamId, name: homeTeamName, logo: homeTeamLogo },
                away: { id: awayTeamId, name: awayTeamName, logo: awayTeamLogo },
                finished,
                homeGoals: finished ? match.score.total.home : null,
                awayGoals: finished ? match.score.total.away : null,
            });

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
                renderLeagueTable();
                savePrediction(comp, match.id, homeInput.value, awayInput.value);
            });
            awayInput.addEventListener('input', () => {
                renderLeagueTable();
                savePrediction(comp, match.id, homeInput.value, awayInput.value);
            });

            // Add keydown event listeners for handling arrow keys movement
            homeInput.addEventListener('keydown', handleScoreInputKeydown);
            awayInput.addEventListener('keydown', handleScoreInputKeydown);
        }
    });

    renderLeagueTable();

    // Hide loading indicator and show matches container
    document.getElementById('loading-indicator').style.display = 'none';
    document.getElementById('matches').style.display = 'block';
    document.getElementById('league-table').style.display = 'block';

    checkLateEntry();
}

// Builds the { match_id, home, away } payload for every loaded match, using
// whatever's currently displayed (real score for finished matches, current
// input value otherwise) — the freeze rule server-side decides what actually
// gets accepted, so the client doesn't need to pre-filter anything.
function buildPredictionsPayload() {
    return currentMatches.map((match) => {
        const { home, away } = readGoalsForMatch(match);
        return { match_id: match.id, home, away };
    });
}

// Copies official Supabase-saved predictions back down over the local
// working copy, for non-finished matches only — a finished match's input is
// disabled and always shows the real score regardless of what was saved.
function applyLoadedPredictions(officialRows) {
    officialRows.forEach(({ match_id, predicted_home, predicted_away }) => {
        const match = currentMatches.find((m) => m.id === match_id);
        if (!match || match.finished) return;
        const homeInput = document.getElementById(`home-${match_id}`);
        const awayInput = document.getElementById(`away-${match_id}`);
        if (homeInput) homeInput.value = String(predicted_home);
        if (awayInput) awayInput.value = String(predicted_away);
        savePrediction(currentComp, match_id, String(predicted_home), String(predicted_away));
    });
    renderLeagueTable();
}

async function handleSavePredictions() {
    const user = await getCurrentUser();
    if (!user) {
        showNotification('Sign in to save your official predictions');
        return;
    }
    if (!currentSeasonYear) {
        showNotification('Matches are still loading — try again in a moment');
        return;
    }

    try {
        // A first-ever save made after the deadline creates a late entry
        // that locks immediately (see save_match_predictions_batch) - warn
        // before committing to that, the same way clearPredictions() warns
        // before an irreversible reset.
        const [existingEntry, deadlinePassed] = await Promise.all([
            getMyEntry(user.id, currentComp, currentSeasonYear),
            isDeadlinePassed(currentComp, currentSeasonYear),
        ]);
        if (!existingEntry && deadlinePassed) {
            const confirmed = confirm(
                'This competition has already started. Saving now creates a late entry that locks immediately — you will not be able to change it again. Continue?'
            );
            if (!confirmed) return;
        }

        const result = await saveMatchPredictionsBatch(currentComp, currentSeasonYear, buildPredictionsPayload());
        const savedCount = (result && result.saved ? result.saved : []).length;

        if (result && result.locked) {
            // The deadline has passed and this entry (on-time or late) was
            // already locked before this call - a no-op by design, not an error.
            showNotification('The deadline has passed — this entry is locked and can no longer be changed');
        } else {
            showNotification(`Saved ${savedCount} match${savedCount === 1 ? '' : 'es'}!`);
        }
        checkLateEntry();
    } catch (err) {
        console.error('Failed to save predictions:', err);
        showNotification('Failed to save predictions — please try again');
    }
}

async function handleLoadPredictions() {
    const user = await getCurrentUser();
    if (!user) {
        showNotification('Sign in to load your saved predictions');
        return;
    }
    if (!currentSeasonYear) {
        return;
    }
    const confirmed = confirm('Load your saved predictions? This will overwrite any unsaved local changes for this competition.');
    if (!confirmed) {
        return;
    }
    try {
        const rows = await loadOfficialPredictions(currentComp, currentSeasonYear);
        if (!rows || rows.length === 0) {
            showNotification('No saved predictions found for this competition yet');
            return;
        }
        applyLoadedPredictions(rows);
        showNotification('Loaded your saved predictions');
    } catch (err) {
        console.error('Failed to load predictions:', err);
        showNotification('Failed to load predictions — please try again');
    }
}

// Lets a late-entry notice fire at most once ever per competition+season
// (persisted, so a page reload doesn't repeat it — only an in-memory flag
// would reset on every reload), rather than every time fetchMatches()
// re-runs for a competition the user has already been told about.
function hasShownLateEntryNotice(key) {
    try {
        return localStorage.getItem(`lateEntryNoticeShown_${key}`) === 'true';
    } catch (err) {
        return false;
    }
}
function markLateEntryNoticeShown(key) {
    try {
        localStorage.setItem(`lateEntryNoticeShown_${key}`, 'true');
    } catch (err) {
        console.error('Failed to save late-entry notice state:', err);
    }
}

// Toasts a one-time "late entry" notice for the signed-in user's entries row
// on the current competition+season (created on their first official save —
// see save_match_predictions_batch). A toast rather than a persistent banner:
// it's informational, not something that needs to stay on screen, and it
// naturally avoids any stale/mismatched state when switching competitions.
async function checkLateEntry() {
    const user = await getCurrentUser();
    if (!user || !currentSeasonYear) return;

    const noticeKey = `${currentComp}_${currentSeasonYear}`;
    if (hasShownLateEntryNotice(noticeKey)) return;

    try {
        const entry = await getMyEntry(user.id, currentComp, currentSeasonYear);
        if (entry && entry.is_late) {
            markLateEntryNoticeShown(noticeKey);
            const weeks = entry.late_weeks;
            showNotification(`Late entry — ${weeks} week${weeks === 1 ? '' : 's'} behind`);
        }
    } catch (err) {
        console.error('Failed to check entry status:', err);
    }
}

// Function to update the color scheme
function updateColorScheme() {
    // Body background, nav bar, competition buttons, favicon, and title are
    // shared by every page — handled once in theme.js.
    const colors = applySharedTheme(currentComp);

    // Everything below is specific to this (predicting) page.

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

    // Apply color scheme to copy standings button
    const copyStandingsButton = document.getElementById('copy-standings');
    copyStandingsButton.style.backgroundColor = colors.nav;
    copyStandingsButton.addEventListener('mouseover', () => {
        copyStandingsButton.style.backgroundColor = colors.match;
    });
    copyStandingsButton.addEventListener('mouseout', () => {
        copyStandingsButton.style.backgroundColor = colors.nav;
    });

    // Apply color scheme to clear predictions button
    const clearPredictionsButton = document.getElementById('clear-predictions');
    clearPredictionsButton.style.backgroundColor = colors.nav;
    clearPredictionsButton.addEventListener('mouseover', () => {
        clearPredictionsButton.style.backgroundColor = colors.match;
    });
    clearPredictionsButton.addEventListener('mouseout', () => {
        clearPredictionsButton.style.backgroundColor = colors.nav;
    });

    // Apply color scheme to the save/load official predictions buttons
    [document.getElementById('load-predictions'), document.getElementById('save-predictions')].forEach((button) => {
        if (!button) return;
        button.style.backgroundColor = colors.nav;
        button.addEventListener('mouseover', () => {
            button.style.backgroundColor = colors.match;
        });
        button.addEventListener('mouseout', () => {
            button.style.backgroundColor = colors.nav;
        });
    });
}

// Reads the goals for one match: fixed real score if finished, otherwise
// whatever is currently typed in its score inputs (defaulting to 0), so the
// table updates live as the user predicts future matches.
function readGoalsForMatch(match) {
    if (match.finished) {
        return { home: match.homeGoals, away: match.awayGoals };
    }
    const home = parseInt(document.getElementById(`home-${match.id}`)?.value, 10) || 0;
    const away = parseInt(document.getElementById(`away-${match.id}`)?.value, 10) || 0;
    return { home, away };
}

// Function to recompute and re-render the league table from the current
// (real + predicted) scores of every loaded match.
function renderLeagueTable() {
    const tableBody = document.querySelector('#league-table tbody');
    tableBody.innerHTML = '';  // Clear current table

    const matchesForStandings = currentMatches.map((match) => {
        const { home: homeGoals, away: awayGoals } = readGoalsForMatch(match);
        return {
            id: match.id,
            home: match.home,
            away: match.away,
            homeGoals,
            awayGoals,
        };
    });

    const standings = computeStandings(matchesForStandings);

    // Populate the table with sorted teams
    standings.forEach((team) => {
        const row = document.createElement('tr');
        // Add 'top-8' class to the first 8 teams
        if (team.rank <= 8) {
            row.classList.add('top-8');
        }
        // Add 'top-24' class to the first 24 teams
        else if (team.rank <= 24) {
            row.classList.add('top-24');
        }
        row.innerHTML = `
            <td>${team.rank}</td> <!-- Position column -->
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

// Function to clear all saved predictions for the current competition and restart it
function clearPredictions() {
    const confirmed = confirm('Clear all your predictions for this competition? This cannot be undone.');
    if (!confirmed) {
        return;
    }
    localStorage.removeItem(getPredictionsStorageKey(currentComp));
    fetchMatches(currentComp);
    showNotification('Predictions cleared!');
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
    document.getElementById('clear-predictions').addEventListener('click', clearPredictions);
    document.getElementById('save-predictions').addEventListener('click', handleSavePredictions);
    document.getElementById('load-predictions').addEventListener('click', handleLoadPredictions);

    wireCompButtons();
    window.addEventListener('comp-changed', (event) => fetchMatches(event.detail.comp));

    setupNav();
    setupTablePanelToggle();

    // Save/Load only make sense once signed in - hide them otherwise, and
    // re-check the late-entry notice whenever sign-in state changes (e.g.
    // signing in while already on this page), not just on initial load.
    onAuthStateChange((user) => {
        const loadButton = document.getElementById('load-predictions');
        const saveButton = document.getElementById('save-predictions');
        if (loadButton) loadButton.hidden = !user;
        if (saveButton) saveButton.hidden = !user;
        checkLateEntry();
    });
});

// Lets the user collapse the standings panel so the predictions area can use the freed-up space
function setupTablePanelToggle() {
    const container = document.querySelector('.container');
    const toggleButton = document.getElementById('toggle-table');
    const storageKey = 'tablePanelCollapsed';

    const applyState = (collapsed) => {
        container.classList.toggle('table-collapsed', collapsed);
        toggleButton.setAttribute('aria-expanded', String(!collapsed));
        const label = collapsed ? 'Expand standings' : 'Collapse standings';
        toggleButton.title = label;
        toggleButton.setAttribute('aria-label', label);
    };

    let collapsed = false;
    try {
        collapsed = localStorage.getItem(storageKey) === 'true';
    } catch (err) {
        console.error('Failed to read table panel state:', err);
    }
    applyState(collapsed);

    toggleButton.addEventListener('click', () => {
        collapsed = !collapsed;
        applyState(collapsed);
        try {
            localStorage.setItem(storageKey, String(collapsed));
        } catch (err) {
            console.error('Failed to save table panel state:', err);
        }
    });
}

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

    // Fetch matches for the selected (or last-used, or default) competition
    fetchMatches(syncUrlToSelectedComp());

    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/sw.js');
    }
};
