// Entry script for admin.html. Shared chrome (theme, competition switcher,
// hamburger sidebar/auth) plus a client-side gate on the page content — real
// enforcement of who can actually write admin data lives server-side in the
// RPCs (see adminConfig.js and the SQL migrations); this is purely so a
// non-admin visitor doesn't see admin content/UI at all.
//
// Season conclusion/actual-standings is fully automatic (see
// api/sync-matches.js) - there is deliberately no admin action for it here.
import { applySharedTheme, getColors, themeSelectOptions, wireButtonHover } from './theme.js';
import { syncUrlToSelectedComp, wireCompButtons, getSelectedComp, linkWithComp } from './compSelector.js';
import { setupNav } from './nav.js';
import { onAuthStateChange } from './auth.js';
import { isAdminUser } from './adminConfig.js';
import { showNotification, queueNotificationForNextPage } from './notify.js';
import { listCompetitionSeasons } from './api/leaderboard.js';
import { fetchSeasonMatches, deriveRoster } from './api/seasonMatches.js';
import {
    importGuestEntry,
    mergeGuestKey,
    reviewGuestClaim,
    findUserByEmail,
    listPendingGuestClaimRequests,
    renameProfile,
    renameGuest,
    listAllProfiles,
} from './api/adminActions.js';
import { listUnclaimedGuestIdentities } from './api/guestClaims.js';

// Tracks whether this page load has *ever* seen an admin session, so the
// gate can tell "never had access" apart from "had access, then signed out".
// One-way (true and stays true) rather than tracking the *previous* call's
// result — Supabase's onAuthStateChange can fire more than one event around
// a sign-out, and a plain "previous" flag would get reset to false by the
// first non-admin call, wrongly treating a second one as a fresh visit again.
let hasEverBeenConfirmedAdmin = false;

// The season roster the guest-import form's pasted list gets matched
// against - loaded automatically whenever the competition/season selection
// changes, no admin action needed.
let currentRoster = [];

// guestKey -> displayName for every currently-unclaimed identity, kept in
// sync with the datalist so typing an *existing* key can autofill the name
// that was already used for them (see wireGuestImportForm's key input
// listener below) instead of the admin having to remember/retype it.
let guestKeyToDisplayName = new Map();

// The "change a display name" search's option label -> what to rename.
// Keyed by the exact composite label shown in its datalist (plain display
// names alone aren't guaranteed unique, hence the "(account)"/"(guestkey)"
// suffix - see refreshRenameOptions).
let renameOptionsByLabel = new Map();

function seasonLabel(seasonYear) {
    return `${seasonYear - 1}/${String(seasonYear).slice(-2)}`;
}

// Not just an in-place content swap: a non-admin (including one who just
// signed out while sitting on this page) gets sent away entirely, since
// there's nothing on this page relevant to them.
function updateGate(user) {
    const allowed = isAdminUser(user);

    if (allowed) {
        hasEverBeenConfirmedAdmin = true;
        const gateMessage = document.getElementById('admin-gate-message');
        const content = document.getElementById('admin-content');
        if (gateMessage) gateMessage.hidden = true;
        if (content) content.hidden = false;
        initAdminContentOnce();
        return;
    }

    if (!hasEverBeenConfirmedAdmin) {
        queueNotificationForNextPage('Admin access required');
    }
    window.location.replace(linkWithComp('/leaderboard'));
}

// Resolves once the <select> options (and its chosen value) are settled, so
// callers can immediately follow up with a roster load for that value.
async function populateSeasonSelect(selectEl, comp) {
    try {
        const seasons = await listCompetitionSeasons(comp);
        const previousValue = selectEl.value;
        selectEl.innerHTML = '';
        seasons.forEach((season) => {
            const option = document.createElement('option');
            option.value = String(season.season_year);
            option.textContent = seasonLabel(season.season_year);
            selectEl.appendChild(option);
        });
        // Keep whatever was selected if it's still an option after a
        // competition switch; otherwise default to the most recent (current).
        if (seasons.some((season) => String(season.season_year) === previousValue)) {
            selectEl.value = previousValue;
        }
    } catch (err) {
        console.error('Failed to load seasons:', err);
    }
}

// Loads the real roster for whatever competition/season is currently
// selected - called automatically (page load, and whenever the competition
// or season selection changes), never via a manual button.
async function loadTeamsForGuestImport() {
    const comp = getSelectedComp();
    const seasonYear = Number(document.getElementById('guest-import-season').value);
    if (!seasonYear) {
        currentRoster = [];
        return;
    }
    try {
        const matches = await fetchSeasonMatches(comp, seasonYear);
        currentRoster = deriveRoster(matches);
    } catch (err) {
        console.error('Failed to load teams:', err);
        currentRoster = [];
        showNotification(err.message || 'Failed to load teams for this season — please try again');
    }
}

// Matches a pasted list of team names (one per line, best to worst) against
// the loaded roster so the saved ranking uses real team ids/logos - not the
// typed text - without making the admin click through 36 teams by hand.
// Case/whitespace-insensitive exact match; anything that doesn't match is
// reported back rather than guessed at.
function matchPastedTeams(rawText, roster) {
    const rosterByName = new Map(roster.map((team) => [team.name.trim().toLowerCase(), team]));
    const lines = rawText.split('\n').map((line) => line.trim()).filter((line) => line.length > 0);
    const matched = [];
    const unmatched = [];
    lines.forEach((line) => {
        const team = rosterByName.get(line.toLowerCase());
        if (team) matched.push(team);
        else unmatched.push(line);
    });
    return { matched, unmatched };
}

function normalizeGuestKey(raw) {
    return raw.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
}

async function refreshGuestKeyOptions() {
    const datalist = document.getElementById('guest-key-options');
    try {
        const identities = await listUnclaimedGuestIdentities();
        datalist.innerHTML = '';
        guestKeyToDisplayName = new Map(identities.map((identity) => [identity.guestKey, identity.displayName]));
        identities.forEach((identity) => {
            const option = document.createElement('option');
            option.value = identity.guestKey;
            option.label = identity.displayName;
            datalist.appendChild(option);
        });
    } catch (err) {
        console.error('Failed to load existing guest keys:', err);
    }
}

function wireGuestImportForm() {
    document.getElementById('guest-import-season').addEventListener('change', loadTeamsForGuestImport);

    // Reuse the same person's existing display name once the typed key
    // matches one of theirs from a past import - the datalist offers the
    // key itself, but not the name that goes with it, so this fills that in.
    document.getElementById('guest-import-key').addEventListener('input', (event) => {
        const displayName = guestKeyToDisplayName.get(normalizeGuestKey(event.target.value));
        if (displayName) {
            document.getElementById('guest-import-name').value = displayName;
        }
    });

    const form = document.getElementById('guest-import-form');
    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const guestKey = normalizeGuestKey(document.getElementById('guest-import-key').value);
        const displayName = document.getElementById('guest-import-name').value.trim();
        const weeksLate = Number(document.getElementById('guest-import-weeks-late').value) || 0;
        const seasonYear = Number(document.getElementById('guest-import-season').value);
        const rawRanking = document.getElementById('guest-import-ranking').value;

        if (!guestKey || !displayName || !seasonYear) {
            showNotification('Fill in a guest key, display name, and season');
            return;
        }
        if (currentRoster.length === 0) {
            showNotification('Teams for this season haven\'t loaded yet — try again in a moment');
            return;
        }

        const { matched, unmatched } = matchPastedTeams(rawRanking, currentRoster);
        if (unmatched.length > 0) {
            showNotification(`Could not match: ${unmatched.join(', ')}`);
            return;
        }
        if (matched.length === 0) {
            showNotification('Paste at least one team, one per line');
            return;
        }

        const rankings = matched.map((team, index) => ({
            team_id: team.id,
            team_name: team.name,
            team_logo_url: team.logo,
            predicted_rank: index + 1,
        }));

        try {
            await importGuestEntry(guestKey, displayName, getSelectedComp(), seasonYear, rankings, weeksLate > 0, weeksLate);
            showNotification(`Imported ${rankings.length} teams for ${displayName} (${guestKey})`);
            // Not form.reset() - that would also reset the season <select>
            // back to its default option, and the roster is still valid for
            // the next import (same season/competition), so keep both.
            document.getElementById('guest-import-key').value = '';
            document.getElementById('guest-import-name').value = '';
            document.getElementById('guest-import-weeks-late').value = '0';
            document.getElementById('guest-import-ranking').value = '';
            refreshGuestKeyOptions();
        } catch (err) {
            console.error('Failed to import guest entry:', err);
            showNotification(err.message || 'Failed to import — please try again');
        }
    });
}

async function renderClaimRequests() {
    const container = document.getElementById('claim-requests-list');
    container.innerHTML = '';
    let requests;
    try {
        requests = await listPendingGuestClaimRequests();
    } catch (err) {
        console.error('Failed to load claim requests:', err);
        container.textContent = 'Failed to load claim requests.';
        return;
    }

    if (requests.length === 0) {
        container.textContent = 'No pending requests.';
        return;
    }

    // Content action buttons always hover to `score`, on every competition -
    // see the .admin-content .sidebar-account-btn rule in theme.js.
    const hoverColor = getColors(getSelectedComp()).score;
    requests.forEach((request) => {
        const row = document.createElement('div');
        row.className = 'admin-list-row';

        const label = document.createElement('span');
        label.textContent = `${request.requesterDisplayName} says they're "${request.guestDisplayName}" (${request.seasons.join(', ') || request.guestKey})`;
        row.appendChild(label);

        const approveButton = document.createElement('button');
        approveButton.type = 'button';
        approveButton.className = 'sidebar-account-btn';
        approveButton.textContent = 'Approve';
        wireButtonHover(approveButton, hoverColor);
        approveButton.addEventListener('click', async () => {
            try {
                await reviewGuestClaim(request.id, true);
                showNotification('Approved and linked');
                renderClaimRequests();
            } catch (err) {
                console.error('Failed to approve claim:', err);
                showNotification(err.message || 'Failed to approve — please try again');
            }
        });
        row.appendChild(approveButton);

        const rejectButton = document.createElement('button');
        rejectButton.type = 'button';
        rejectButton.className = 'sidebar-account-btn';
        rejectButton.textContent = 'Reject';
        wireButtonHover(rejectButton, hoverColor);
        rejectButton.addEventListener('click', async () => {
            try {
                await reviewGuestClaim(request.id, false);
                showNotification('Rejected');
                renderClaimRequests();
            } catch (err) {
                console.error('Failed to reject claim:', err);
                showNotification(err.message || 'Failed to reject — please try again');
            }
        });
        row.appendChild(rejectButton);

        container.appendChild(row);
    });
}

function wireManualMergeForm() {
    const form = document.getElementById('manual-merge-form');
    const resultBox = document.getElementById('manual-merge-result');

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        resultBox.innerHTML = '';
        const email = document.getElementById('manual-merge-email').value.trim();
        if (!email) return;

        let user, identities;
        try {
            [user, identities] = await Promise.all([findUserByEmail(email), listUnclaimedGuestIdentities()]);
        } catch (err) {
            console.error('Failed to look up user:', err);
            showNotification(err.message || 'Lookup failed — please try again');
            return;
        }

        if (!user) {
            resultBox.textContent = 'No account found with that email — they need to sign in at least once first.';
            return;
        }
        if (identities.length === 0) {
            resultBox.textContent = `Found ${user.displayName}, but there are no unclaimed guest entries.`;
            return;
        }

        const label = document.createElement('p');
        label.textContent = `Found: ${user.displayName}. Pick which guest identity is theirs:`;
        resultBox.appendChild(label);

        const comp = getSelectedComp();
        const colors = getColors(comp);

        const select = document.createElement('select');
        select.className = 'admin-select';
        select.style.backgroundColor = colors.top8;
        identities.forEach((identity) => {
            const option = document.createElement('option');
            option.value = identity.guestKey;
            const seasonsText = identity.seasons
                .map((season) => `${season.competition.toUpperCase()} ${seasonLabel(season.seasonYear)}`)
                .join(', ');
            option.textContent = `${identity.displayName} (${identity.guestKey}) — ${seasonsText}`;
            select.appendChild(option);
        });
        themeSelectOptions(select, colors.top8, colors.score);
        resultBox.appendChild(select);

        const mergeButton = document.createElement('button');
        mergeButton.type = 'button';
        mergeButton.className = 'sidebar-account-btn';
        mergeButton.textContent = 'Merge';
        wireButtonHover(mergeButton, colors.score);
        mergeButton.addEventListener('click', async () => {
            try {
                const result = await mergeGuestKey(select.value, user.userId);
                const overwriteNote = result.overwritten.length
                    ? `, replaced ${result.overwritten.length} existing entr${result.overwritten.length === 1 ? 'y' : 'ies'} on that account`
                    : '';
                showNotification(`Linked ${result.merged} entr${result.merged === 1 ? 'y' : 'ies'}${overwriteNote}`);
                resultBox.innerHTML = '';
                form.reset();
                renderClaimRequests();
            } catch (err) {
                console.error('Failed to merge guest entry:', err);
                showNotification(err.message || 'Failed to merge — please try again');
            }
        });
        resultBox.appendChild(mergeButton);
    });
}

// Populates the "change a display name" search's datalist from both real
// accounts and still-unclaimed guest identities - a plain display name isn't
// guaranteed unique (two different real accounts could coincidentally share
// one), so each option's label disambiguates with what it actually targets.
async function refreshRenameOptions() {
    const datalist = document.getElementById('rename-options');
    try {
        const [profiles, identities] = await Promise.all([listAllProfiles(), listUnclaimedGuestIdentities()]);
        renameOptionsByLabel = new Map();
        datalist.innerHTML = '';

        profiles.forEach((profile) => {
            if (!profile.displayName) return;
            const label = `${profile.displayName} (account)`;
            renameOptionsByLabel.set(label, { kind: 'user', target: profile.userId, currentName: profile.displayName });
            const option = document.createElement('option');
            option.value = label;
            datalist.appendChild(option);
        });

        identities.forEach((identity) => {
            const label = `${identity.displayName} (${identity.guestKey})`;
            renameOptionsByLabel.set(label, { kind: 'guest', target: identity.guestKey, currentName: identity.displayName });
            const option = document.createElement('option');
            option.value = label;
            datalist.appendChild(option);
        });
    } catch (err) {
        console.error('Failed to load rename options:', err);
    }
}

function wireRenameForm() {
    // Same "existing option -> autofill the current value" pattern as the
    // guest-import form's key field, so the admin can see what they're
    // about to overwrite before typing the new name.
    document.getElementById('rename-search').addEventListener('input', (event) => {
        const match = renameOptionsByLabel.get(event.target.value);
        if (match) {
            document.getElementById('rename-new-name').value = match.currentName;
        }
    });

    const form = document.getElementById('rename-form');
    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        const match = renameOptionsByLabel.get(document.getElementById('rename-search').value);
        const newName = document.getElementById('rename-new-name').value.trim();

        if (!match) {
            showNotification('Pick a valid option from the list');
            return;
        }
        if (!newName) {
            showNotification('Enter a display name');
            return;
        }

        try {
            if (match.kind === 'user') {
                await renameProfile(match.target, newName);
            } else {
                await renameGuest(match.target, newName);
            }
            showNotification(`Renamed to "${newName}"`);
            form.reset();
            refreshRenameOptions();
            // Both surfaces can show a guest's/requester's display name.
            refreshGuestKeyOptions();
            renderClaimRequests();
        } catch (err) {
            console.error('Failed to rename:', err);
            showNotification(err.message || 'Failed to rename — please try again');
        }
    });
}

let hasInitializedAdminContent = false;

async function refreshSeasonAndRoster(comp) {
    const select = document.getElementById('guest-import-season');
    await populateSeasonSelect(select, comp);
    await loadTeamsForGuestImport();
}

function initAdminContentOnce() {
    if (hasInitializedAdminContent) return;
    hasInitializedAdminContent = true;

    refreshSeasonAndRoster(getSelectedComp());
    refreshGuestKeyOptions();
    refreshRenameOptions();

    wireGuestImportForm();
    wireManualMergeForm();
    wireRenameForm();
    renderClaimRequests();

    window.addEventListener('comp-changed', (event) => refreshSeasonAndRoster(event.detail.comp));
}

document.addEventListener('DOMContentLoaded', () => {
    wireCompButtons();
    window.addEventListener('comp-changed', (event) => applySharedTheme(event.detail.comp));

    setupNav();

    applySharedTheme(syncUrlToSelectedComp());

    onAuthStateChange(updateGate);

    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/sw.js');
    }
});
