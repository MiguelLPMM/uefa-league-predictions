// Entry script for profile.html. Shared chrome (theme, competition switcher,
// hamburger sidebar/auth) plus a client-side gate on the page content -
// signed-in only, unlike admin.html there's no further restriction.
//
// This is the persistent counterpart to guestClaimPrompt.js's one-time
// sign-in popup: unlike that popup, which only ever fires once (and never
// again after a dismiss or a request), this page lets a user revisit their
// guest-claim choice anytime - propose a different one, or cancel a pending
// request - since "none of these are me" or "the admin never got back to
// me" shouldn't be dead ends.
import { applySharedTheme } from './theme.js';
import { syncUrlToSelectedComp, wireCompButtons, getSelectedComp } from './compSelector.js';
import { setupNav } from './nav.js';
import { onAuthStateChange } from './auth.js';
import { getColors, wireButtonHover } from './theme.js';
import { showNotification } from './notify.js';
import { createAvatar } from './avatar.js';
import { loadMyHistory } from './api/history.js';
import { mountHistoryChart } from './historyChart.js';
import {
    listUnclaimedGuestIdentities,
    getMyPendingClaimRequest,
    hasCompletedGuestMerge,
    requestGuestClaim,
    cancelGuestClaimRequest,
} from './api/guestClaims.js';

let currentUser = null;

const COMPETITIONS = ['ucl', 'uel', 'uecl'];
let historyData = null; // Map(comp -> { seasons, series }) for the signed-in user
let historyCharts = [];

function seasonLabel(seasonYear) {
    return `${seasonYear - 1}/${String(seasonYear).slice(-2)}`;
}

function renderAccountInfo(user) {
    const container = document.getElementById('profile-account-info');
    container.innerHTML = '';

    const meta = user.user_metadata || {};
    const avatar = createAvatar(meta.avatar_url);
    avatar.classList.add('profile-avatar');
    container.appendChild(avatar);

    const details = document.createElement('span');
    const displayName = meta.full_name || meta.name || 'Signed in';
    details.textContent = user.email ? `${displayName} (${user.email})` : displayName;
    container.appendChild(details);
}

async function renderClaimStatus() {
    const container = document.getElementById('profile-claim-status');
    container.innerHTML = 'Loading…';

    let alreadyMerged;
    try {
        alreadyMerged = await hasCompletedGuestMerge(currentUser.id);
    } catch (err) {
        console.error('Failed to load claim status:', err);
        container.textContent = 'Failed to load — please try again later.';
        return;
    }

    container.innerHTML = '';

    // Only one self-serve merge ever - a second one being approved by
    // mistake could wipe an already-correct entry (see the 0012 migration).
    // Any further historical predictions to link have to go through the
    // admin directly from here on.
    if (alreadyMerged) {
        container.textContent = "You've already linked a historical account. If you have another one to link, ask the admin to do it directly.";
        return;
    }

    let pending;
    try {
        pending = await getMyPendingClaimRequest(currentUser.id);
    } catch (err) {
        console.error('Failed to load claim status:', err);
        container.textContent = 'Failed to load — please try again later.';
        return;
    }

    if (pending) {
        const row = document.createElement('div');
        row.className = 'admin-list-row';
        const label = document.createElement('span');
        label.textContent = `You said you're "${pending.displayName}" — pending admin review.`;
        row.appendChild(label);

        const cancelButton = document.createElement('button');
        cancelButton.type = 'button';
        cancelButton.className = 'sidebar-account-btn';
        cancelButton.textContent = 'Cancel request';
        // Content action buttons always hover to `score`, on every
        // competition - see the .admin-content .sidebar-account-btn rule in
        // theme.js (matches admin.html's equivalent buttons).
        wireButtonHover(cancelButton, getColors(getSelectedComp()).score);
        cancelButton.addEventListener('click', async () => {
            try {
                await cancelGuestClaimRequest(pending.id);
                showNotification('Request cancelled');
                renderClaimStatus();
            } catch (err) {
                console.error('Failed to cancel claim request:', err);
                showNotification('Failed to cancel — please try again');
            }
        });
        row.appendChild(cancelButton);
        container.appendChild(row);
        return;
    }

    let identities;
    try {
        identities = await listUnclaimedGuestIdentities();
    } catch (err) {
        console.error('Failed to load unclaimed identities:', err);
        container.textContent = 'Failed to load — please try again later.';
        return;
    }

    if (identities.length === 0) {
        container.textContent = 'No unclaimed historical entries right now.';
        return;
    }

    const intro = document.createElement('p');
    intro.textContent = 'Were you one of our past players? Pick which one is you:';
    container.appendChild(intro);

    const list = document.createElement('div');
    list.className = 'guest-claim-list';
    const hoverColor = getColors(getSelectedComp()).score;
    identities.forEach((identity) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'sidebar-account-btn';
        wireButtonHover(button, hoverColor);
        const seasonsText = identity.seasons
            .map((season) => `${getColors(season.competition).name} ${seasonLabel(season.seasonYear)}`)
            .join(', ');
        button.textContent = `${identity.displayName} — ${seasonsText}`;
        button.addEventListener('click', async () => {
            try {
                await requestGuestClaim(currentUser.id, identity.guestKey);
                showNotification('Request sent — the admin will review it');
                renderClaimStatus();
            } catch (err) {
                console.error('Failed to send claim request:', err);
                showNotification('Something went wrong — please try again');
            }
        });
        list.appendChild(button);
    });
    container.appendChild(list);
}

function destroyHistoryCharts() {
    historyCharts.forEach((chart) => chart.destroy());
    historyCharts = [];
}

// One chart per competition. Re-run on a competition switch too, since the
// chart chrome (panel background, accent) follows the selected competition's theme.
function renderHistory() {
    if (!historyData) return;
    const area = document.getElementById('profile-history');
    destroyHistoryCharts();
    area.innerHTML = '';

    const colors = getColors(getSelectedComp());
    const withEntries = COMPETITIONS.filter((comp) => historyData.get(comp)?.series.length);
    if (withEntries.length === 0) {
        area.textContent = 'No predictions recorded for you yet.';
        return;
    }

    withEntries.forEach((comp) => {
        const heading = document.createElement('h3');
        heading.className = 'profile-history-title';
        heading.textContent = getColors(comp).name;
        const box = document.createElement('div');
        area.append(heading, box);
        historyCharts.push(mountHistoryChart(box, historyData.get(comp), {
            height: 220,
            note: false, // explained once, in the section intro
            background: colors.match,
            accent: colors.score,
        }));
    });
}

async function loadHistory() {
    const area = document.getElementById('profile-history');
    area.textContent = 'Loading…';
    try {
        historyData = await loadMyHistory(currentUser.id, COMPETITIONS);
    } catch (err) {
        console.error('Failed to load history:', err);
        historyData = null;
        area.textContent = 'Failed to load your history — please try again later.';
        return;
    }
    if (currentUser) renderHistory();
}

function updateGate(user) {
    const gateMessage = document.getElementById('profile-gate-message');
    const content = document.getElementById('profile-content');

    if (user) {
        currentUser = user;
        gateMessage.hidden = true;
        content.hidden = false;
        renderAccountInfo(user);
        renderClaimStatus();
        loadHistory();
    } else {
        currentUser = null;
        historyData = null;
        destroyHistoryCharts();
        gateMessage.hidden = false;
        content.hidden = true;
    }
}

document.addEventListener('DOMContentLoaded', () => {
    wireCompButtons();
    window.addEventListener('comp-changed', (event) => {
        applySharedTheme(event.detail.comp);
        renderHistory();
    });

    setupNav();

    applySharedTheme(syncUrlToSelectedComp());

    // Must compare user ids, not just react to every call - Supabase also
    // fires this on a plain token refresh (notably when the tab regains
    // focus after being backgrounded), which isn't a real sign-in/out and
    // would otherwise re-fetch/re-render this page's content every time.
    let previousUserId;
    onAuthStateChange((user) => {
        const currentUserId = user ? user.id : null;
        if (previousUserId !== undefined && currentUserId === previousUserId) return;
        previousUserId = currentUserId;
        updateGate(user);
    });

    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/sw.js');
    }
});
