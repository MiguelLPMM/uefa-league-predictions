// Entry script for leaderboard.html: shared chrome (theme, competition
// switcher, hamburger sidebar/auth) plus all 3 leaderboard views - the
// per-user breakdown (view 1), the actual-table lateral-scroll view (view 2)
// and the live ranked list (view 3) - favorites, and the drill-down modal.
import { applySharedTheme, getColors } from './theme.js';
import { syncUrlToSelectedComp, wireCompButtons } from './compSelector.js';
import { setupNav } from './nav.js';
import { getCurrentUser, onAuthStateChange } from './auth.js';
import {
    getCurrentCompetitionSeason,
    getCompetitionSeasonByYear,
    listCompetitionSeasons,
    getMatchesCache,
    getEntriesWithProfiles,
    getAllPredictions,
    getFixedRankPredictionsByEntry,
    getSeasonActualStandings,
} from './api/leaderboard.js';
import { getFavoriteUserIds, addFavorite, removeFavorite } from './api/favorites.js';
import { computeActualStandings, computeUserPredictedStandings, computeOffsets } from './scoring.js';
import { setupDrilldownModal, openDrilldown } from './drilldown.js';

const VIEW_STORAGE_KEY = 'leaderboardView';
const VALID_VIEWS = ['live', 'table', 'breakdown'];

// The competition currently selected via the nav buttons - tracked so the
// season-select and auth-change handlers (which don't otherwise know it) can
// re-run loadLeaderboard for the right competition.
let currentComp = null;

// Everything needed to re-render (or re-order) the current competition's
// leaderboard without another network round-trip - populated by
// loadLeaderboard(), read by the favorite-toggle/re-render path.
let session = null;

function getSelectedView() {
    try {
        const stored = localStorage.getItem(VIEW_STORAGE_KEY);
        if (VALID_VIEWS.includes(stored)) return stored;
    } catch (err) {
        // Fall through to the default.
    }
    return 'breakdown';
}

function setSelectedView(view) {
    try {
        localStorage.setItem(VIEW_STORAGE_KEY, view);
    } catch (err) {
        // Not worth failing over - worst case the choice doesn't persist.
    }
    document.getElementById('leaderboard-live').hidden = view !== 'live';
    document.getElementById('leaderboard-table').hidden = view !== 'table';
    document.getElementById('leaderboard-breakdown').hidden = view !== 'breakdown';
    document.querySelectorAll('.view-tab').forEach((tab) => {
        tab.classList.toggle('active', tab.dataset.view === view);
    });
}

function showGate(message) {
    document.getElementById('leaderboard-gate-message').textContent = message;
    document.getElementById('leaderboard-gate').hidden = false;
    document.getElementById('leaderboard-content').hidden = true;
}

// Self first (if signed in and has an entry), then favorited users in
// submission-time order, then everyone else in submission-time order.
// `results` must already be in submission-time order (see getEntriesWithProfiles).
// Guest entries have user_id = null, same as a signed-out visitor's
// currentUserId - guard explicitly so those never get treated as "self".
function buildColumnOrder(results, currentUserId, favoriteIds) {
    const favoriteSet = new Set(favoriteIds);
    const isSelf = (r) => currentUserId != null && r.entry.user_id === currentUserId;
    const self = results.filter(isSelf);
    const favorites = results.filter((r) => !isSelf(r) && favoriteSet.has(r.entry.user_id));
    const rest = results.filter((r) => !isSelf(r) && !favoriteSet.has(r.entry.user_id));
    return [...self, ...favorites, ...rest];
}

// Builds the clickable name/avatar/star chip shared by every view - clicking
// it opens the drill-down modal for that user; the star (absent for your own
// entry) toggles favorite status without opening the modal.
function buildUserChip(result, { withAvatar }) {
    const chip = document.createElement('span');
    chip.className = 'leaderboard-user-chip';
    chip.tabIndex = 0;
    const open = () => openDrilldownForResult(result);
    chip.addEventListener('click', open);
    chip.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            open();
        }
    });

    if (withAvatar && result.entry.avatarUrl) {
        const avatar = document.createElement('img');
        avatar.src = result.entry.avatarUrl;
        avatar.alt = '';
        chip.appendChild(avatar);
    }

    const isSelf = Boolean(session && session.currentUserId != null && result.entry.user_id === session.currentUserId);
    const name = document.createElement('span');
    name.className = 'leaderboard-name';
    name.textContent = result.entry.displayName;
    chip.appendChild(name);

    if (result.entry.is_late) {
        const badge = document.createElement('span');
        badge.className = 'leaderboard-late-badge';
        const weeks = result.entry.late_weeks;
        badge.textContent = `${weeks} week${weeks === 1 ? '' : 's'} late`;
        chip.appendChild(badge);
    }

    // Guest (unclaimed) entries have no real user_id, and favorites.
    // favorite_user_id is a not-null FK to auth.users - there's nothing to
    // favorite them by yet. They become favoritable normally the moment
    // someone claims them (see the admin merge flow), since that's what
    // fills in a real user_id.
    if (!isSelf && result.entry.user_id != null) {
        const isFavorite = session && session.favoriteIds.includes(result.entry.user_id);
        const star = document.createElement('button');
        star.type = 'button';
        star.className = isFavorite ? 'favorite-star active' : 'favorite-star';
        star.setAttribute('aria-label', isFavorite ? 'Remove favorite' : 'Add favorite');
        star.innerHTML = `<i class="material-icons">${isFavorite ? 'star' : 'star_border'}</i>`;
        star.addEventListener('click', (event) => {
            event.stopPropagation();
            toggleFavorite(result.entry.user_id, !isFavorite);
        });
        chip.appendChild(star);
    }

    return chip;
}

function openDrilldownForResult(result) {
    if (!session) return;
    // A fixed-rank entry (historical/guest import) only ever has a final
    // ranking on record, never match-by-match picks - the drill-down for
    // those shows just the predicted table, nothing else.
    const isFixedRank = result.entry.entry_mode === 'fixed_rank';
    const predictionsForUser = isFixedRank ? new Map() : (session.predictionsByUser.get(result.entry.user_id) || new Map());
    openDrilldown(result.entry, session.matchesCache, predictionsForUser, result.predictedStandings, session.actualRankByTeamId, session.colors, { hideMatches: isFixedRank });
}

async function toggleFavorite(favoriteUserId, shouldAdd) {
    if (!session) return;
    try {
        if (shouldAdd) {
            await addFavorite(session.currentUserId, favoriteUserId);
            if (!session.favoriteIds.includes(favoriteUserId)) session.favoriteIds.push(favoriteUserId);
        } else {
            await removeFavorite(session.currentUserId, favoriteUserId);
            session.favoriteIds = session.favoriteIds.filter((id) => id !== favoriteUserId);
        }
    } catch (err) {
        console.error('Failed to update favorite:', err);
        return;
    }
    renderAll();
}

function renderLiveView(scoreRankedResults) {
    const container = document.getElementById('leaderboard-live');
    container.innerHTML = '';

    scoreRankedResults.forEach((result, index) => {
        const row = document.createElement('div');
        row.className = 'leaderboard-row';

        const rank = document.createElement('span');
        rank.className = 'leaderboard-rank';
        rank.textContent = String(index + 1);
        row.appendChild(rank);

        row.appendChild(buildUserChip(result, { withAvatar: true }));

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

function renderTableView(actualStandings, columnOrderedResults, colors) {
    const container = document.getElementById('leaderboard-table');
    container.innerHTML = '';

    const table = document.createElement('table');
    table.className = 'leaderboard-actual-table';

    const thead = document.createElement('thead');
    const headRow = document.createElement('tr');

    // Rank + team used to be two adjacent sticky-left columns that had to
    // land at exactly the right offset from each other - one column means
    // there's no second offset to get right in the first place, which is
    // what actually eliminates the gap that kept showing up between them
    // (rather than yet another attempt to compute the "correct" offset).
    const corner = document.createElement('th');
    corner.className = 'frozen-col';
    corner.style.backgroundColor = colors.nav;
    headRow.appendChild(corner);

    columnOrderedResults.forEach((result) => {
        const th = document.createElement('th');
        th.className = 'user-col';
        th.style.backgroundColor = colors.nav;
        th.appendChild(buildUserChip(result, { withAvatar: false }));
        headRow.appendChild(th);
    });
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    actualStandings.forEach((team) => {
        const tierColor = team.rank <= 8 ? colors.top8 : team.rank <= 24 ? colors.match : colors.background;
        const tr = document.createElement('tr');

        const teamCell = document.createElement('td');
        teamCell.className = 'frozen-col';
        teamCell.style.backgroundColor = tierColor;

        // The inner flex wrapper is what lays out rank+logo+name - never
        // the <td> itself (overriding a table cell's own `display` away
        // from table-cell makes it escape normal row layout entirely).
        const inner = document.createElement('span');
        inner.className = 'frozen-team-inner';

        const rank = document.createElement('span');
        rank.className = 'frozen-rank';
        rank.textContent = String(team.rank);
        inner.appendChild(rank);

        if (team.logo) {
            const logo = document.createElement('img');
            logo.src = team.logo;
            logo.alt = '';
            inner.appendChild(logo);
        }
        const name = document.createElement('span');
        name.className = 'frozen-team-name';
        name.textContent = team.name;
        inner.appendChild(name);

        teamCell.appendChild(inner);
        tr.appendChild(teamCell);

        columnOrderedResults.forEach((result) => {
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

// View 1: rows are each user's OWN predicted rank slots 1-36 (not the actual
// standings order) - row N under a given user's column shows the team they
// predicted for position N and how far off that team's actual rank is. A
// closing Total row shows each user's overall score/bang-on count.
function renderBreakdownView(columnOrderedResults, actualRankByTeamId, colors) {
    const container = document.getElementById('leaderboard-breakdown');
    container.innerHTML = '';

    const maxPositions = columnOrderedResults.reduce((max, result) => Math.max(max, result.predictedStandings.length), 0);

    const table = document.createElement('table');
    table.className = 'leaderboard-breakdown-table';

    const thead = document.createElement('thead');
    const headRow = document.createElement('tr');
    const corner = document.createElement('th');
    corner.className = 'frozen-col';
    corner.style.backgroundColor = colors.nav;
    headRow.appendChild(corner);
    columnOrderedResults.forEach((result) => {
        const th = document.createElement('th');
        th.className = 'user-col';
        th.style.backgroundColor = colors.nav;
        th.appendChild(buildUserChip(result, { withAvatar: false }));
        headRow.appendChild(th);
    });
    thead.appendChild(headRow);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    for (let position = 1; position <= maxPositions; position++) {
        const tierColor = position <= 8 ? colors.top8 : position <= 24 ? colors.match : colors.background;
        const tr = document.createElement('tr');

        const positionCell = document.createElement('td');
        positionCell.className = 'frozen-col';
        positionCell.textContent = String(position);
        positionCell.style.backgroundColor = tierColor;
        tr.appendChild(positionCell);

        columnOrderedResults.forEach((result) => {
            const cell = document.createElement('td');
            cell.className = 'user-col breakdown-cell';
            cell.style.backgroundColor = tierColor;

            const team = result.predictedStandings[position - 1];
            if (!team) {
                cell.textContent = '—';
            } else {
                // The grid layout (team column vs. off column) has to live on
                // an inner wrapper, not the <td> itself - overriding a table
                // cell's own `display` away from table-cell makes it escape
                // normal row layout entirely (cells stack instead of sitting
                // side by side).
                const inner = document.createElement('div');
                inner.className = 'breakdown-cell-inner';

                const teamWrap = document.createElement('span');
                teamWrap.className = 'breakdown-team';
                if (team.logo) {
                    const logo = document.createElement('img');
                    logo.src = team.logo;
                    logo.alt = '';
                    teamWrap.appendChild(logo);
                }
                const name = document.createElement('span');
                name.textContent = team.name;
                teamWrap.appendChild(name);
                inner.appendChild(teamWrap);

                const actualRank = actualRankByTeamId.get(team.id);
                const off = document.createElement('span');
                off.className = 'breakdown-off';
                if (actualRank == null) {
                    off.textContent = '—';
                } else {
                    const value = position - actualRank;
                    off.textContent = value > 0 ? `+${value}` : String(value);
                    if (value === 0) off.classList.add('off-bangon');
                }
                inner.appendChild(off);

                cell.appendChild(inner);
            }

            tr.appendChild(cell);
        });

        tbody.appendChild(tr);
    }

    const totalRow = document.createElement('tr');
    totalRow.className = 'breakdown-total-row';
    const totalLabel = document.createElement('td');
    totalLabel.className = 'frozen-col';
    totalLabel.textContent = 'Total';
    totalLabel.style.backgroundColor = colors.nav;
    totalRow.appendChild(totalLabel);
    columnOrderedResults.forEach((result) => {
        const cell = document.createElement('td');
        cell.className = 'user-col';
        cell.style.backgroundColor = colors.nav;
        cell.textContent = `${result.total} · ${result.bangOn} bang on`;
        totalRow.appendChild(cell);
    });
    tbody.appendChild(totalRow);

    table.appendChild(tbody);
    container.appendChild(table);
}

function renderAll() {
    if (!session) return;
    const { results, actualStandings, actualRankByTeamId, currentUserId, favoriteIds, colors } = session;

    const scoreRanked = [...results].sort((a, b) => (a.total - b.total) || (b.bangOn - a.bangOn));
    const columnOrder = buildColumnOrder(results, currentUserId, favoriteIds);

    renderLiveView(scoreRanked);
    renderTableView(actualStandings, columnOrder, colors);
    renderBreakdownView(columnOrder, actualRankByTeamId, colors);
}

// competition_seasons.season_year follows the same convention as seasons.label
// (e.g. 2027 -> "2026/27") - computed here instead of a second query for it.
function seasonLabel(seasonYear) {
    return `${seasonYear - 1}/${String(seasonYear).slice(-2)}`;
}

// The season selector is intentionally rendered outside/above the gate: even
// while the *current* season is still locked, past concluded seasons should
// stay browsable. Only repopulates the option list; selecting one re-runs
// loadLeaderboard for that specific year (wired once in DOMContentLoaded).
async function populateSeasonSelector(comp, selectedSeasonYear) {
    const bar = document.getElementById('leaderboard-season-bar');
    const select = document.getElementById('season-select');
    try {
        const seasons = await listCompetitionSeasons(comp);
        if (seasons.length === 0) {
            bar.hidden = true;
            return;
        }
        select.innerHTML = '';
        seasons.forEach((season) => {
            const option = document.createElement('option');
            option.value = String(season.season_year);
            option.textContent = seasonLabel(season.season_year);
            select.appendChild(option);
        });
        select.value = String(selectedSeasonYear);
        bar.hidden = false;
    } catch (err) {
        console.error('Failed to load season list:', err);
        bar.hidden = true;
    }
}

async function loadLeaderboard(comp, seasonYear) {
    currentComp = comp;
    session = null;
    document.getElementById('leaderboard-gate').hidden = true;
    document.getElementById('leaderboard-content').hidden = true;

    let compSeason;
    try {
        compSeason = seasonYear != null
            ? await getCompetitionSeasonByYear(comp, seasonYear)
            : await getCurrentCompetitionSeason(comp);
    } catch (err) {
        console.error('Failed to load competition season:', err);
        showGate('Failed to load the leaderboard — please try again later.');
        return;
    }

    if (!compSeason) {
        document.getElementById('leaderboard-season-bar').hidden = true;
        showGate('No data recorded yet for this competition.');
        return;
    }

    const resolvedSeasonYear = compSeason.season_year;
    const isConcluded = compSeason.status === 'concluded';
    const isUnlocked = compSeason.reveal_unlocked || isConcluded;

    await populateSeasonSelector(comp, resolvedSeasonYear);

    if (!isUnlocked) {
        showGate("The leaderboard for this competition unlocks once its first match kicks off.");
        return;
    }

    let matchesCache, entries, predictions, fixedRankByEntry, currentUser;
    try {
        [matchesCache, entries, predictions, fixedRankByEntry, currentUser] = await Promise.all([
            getMatchesCache(comp, resolvedSeasonYear),
            getEntriesWithProfiles(comp, resolvedSeasonYear),
            getAllPredictions(comp, resolvedSeasonYear),
            getFixedRankPredictionsByEntry(comp, resolvedSeasonYear),
            getCurrentUser(),
        ]);
    } catch (err) {
        console.error('Failed to load leaderboard data:', err);
        showGate('Failed to load the leaderboard — please try again later.');
        return;
    }

    if (entries.length === 0) {
        showGate('No one has a prediction recorded for this competition yet.');
        return;
    }

    const currentUserId = currentUser ? currentUser.id : null;
    let favoriteIds;
    try {
        favoriteIds = await getFavoriteUserIds(currentUserId);
    } catch (err) {
        console.error('Failed to load favorites:', err);
        favoriteIds = [];
    }

    const predictionsByUser = new Map();
    predictions.forEach((prediction) => {
        if (!predictionsByUser.has(prediction.user_id)) {
            predictionsByUser.set(prediction.user_id, new Map());
        }
        predictionsByUser.get(prediction.user_id).set(prediction.match_id, prediction);
    });

    // Once a season is concluded, its actual standings come from the
    // permanent snapshot rather than matches_cache - which is empty for
    // seasons this app never tracked live (24/25, 25/26), and which the
    // plan deliberately stops treating as authoritative for a finished
    // season even when it's still technically populated.
    let actualStandings;
    try {
        actualStandings = isConcluded
            ? await getSeasonActualStandings(comp, resolvedSeasonYear)
            : computeActualStandings(matchesCache);
    } catch (err) {
        console.error('Failed to load actual standings:', err);
        showGate('Failed to load the leaderboard — please try again later.');
        return;
    }
    const actualRankByTeamId = new Map(actualStandings.map((team) => [team.id, team.rank]));

    const results = entries.map((entry) => {
        const predictedStandings = entry.entry_mode === 'fixed_rank'
            ? (fixedRankByEntry.get(entry.id) || [])
            : computeUserPredictedStandings(matchesCache, predictionsByUser.get(entry.user_id) || new Map());
        const { offsetByTeamId, total, bangOn } = computeOffsets(predictedStandings, actualStandings);
        return { entry, predictedStandings, offsetByTeamId, total, bangOn };
    });

    session = {
        comp,
        seasonYear: resolvedSeasonYear,
        matchesCache,
        predictionsByUser,
        results,
        actualStandings,
        actualRankByTeamId,
        currentUserId,
        favoriteIds,
        colors: getColors(comp),
    };

    renderAll();
    document.getElementById('leaderboard-content').hidden = false;
}

document.addEventListener('DOMContentLoaded', () => {
    wireCompButtons();
    window.addEventListener('comp-changed', (event) => {
        applySharedTheme(event.detail.comp);
        loadLeaderboard(event.detail.comp); // switching competition resets to its current season
    });

    document.querySelectorAll('.view-tab').forEach((tab) => {
        tab.addEventListener('click', () => setSelectedView(tab.dataset.view));
    });
    setSelectedView(getSelectedView());

    const seasonSelect = document.getElementById('season-select');
    if (seasonSelect) {
        seasonSelect.addEventListener('change', () => {
            loadLeaderboard(currentComp, Number(seasonSelect.value));
        });
    }

    setupNav();
    setupDrilldownModal();

    const comp = syncUrlToSelectedComp();
    applySharedTheme(comp);
    loadLeaderboard(comp);

    // Sign-in redirects the whole page (a fresh DOMContentLoaded already
    // picks up the right user), but sign-out doesn't navigate anywhere - so
    // this is what keeps "self" ordering/labeling from going stale if
    // someone signs out while already looking at the leaderboard. Must
    // compare user ids, not just "did this fire again" - Supabase also
    // fires this on a plain token refresh (notably when the tab regains
    // focus after being backgrounded), which isn't a real sign-in/out and
    // was previously re-fetching/re-rendering the whole page every time you
    // switched back to the tab.
    let previousUserId; // undefined = unknown yet, distinct from null = signed out
    onAuthStateChange((user) => {
        const currentUserId = user ? user.id : null;
        if (previousUserId === undefined) {
            previousUserId = currentUserId;
            return;
        }
        if (currentUserId === previousUserId) {
            return;
        }
        previousUserId = currentUserId;
        loadLeaderboard(currentComp, session ? session.seasonYear : undefined);
    });

    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/sw.js');
    }
});
