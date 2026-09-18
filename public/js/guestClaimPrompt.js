// The self-serve "is this you" prompt for guest (no-account) historical
// entries. Runs once per page load for a signed-in user - wired from
// nav.js's setupNav() so it applies on every page without each page having
// to remember to include it. The modal is built entirely in JS (no markup
// to add to every HTML file), reusing the same classes as the drill-down
// modal/sidebar for visual consistency.
import { getColors, getSidebarHoverColor, wireButtonHover } from './theme.js';
import { getSelectedComp } from './compSelector.js';
import {
    listUnclaimedGuestIdentities,
    getMyPendingClaimRequest,
    hasCompletedGuestMerge,
    hasDismissedGuestClaimPrompt,
    dismissGuestClaimPrompt,
    requestGuestClaim,
} from './api/guestClaims.js';
import { showNotification } from './notify.js';

let hasCheckedThisPageLoad = false;

function seasonLabel(seasonYear) {
    return `${seasonYear - 1}/${String(seasonYear).slice(-2)}`;
}

function closePrompt(overlay, modal) {
    overlay.remove();
    modal.remove();
}

function buildModal(user, identities) {
    const overlay = document.createElement('div');
    overlay.className = 'sidebar-overlay';

    const comp = getSelectedComp();
    const colors = getColors(comp);
    // Built fresh each time (unlike the leaderboard's persistent drill-down
    // modal, which theme.js recolors on load/comp-change) - every themed
    // element here has to set its own color from whatever competition is
    // currently selected, and wire its own hover (theme.js's sweep only
    // reaches elements already in the DOM when it last ran).
    const chromeHoverColor = getSidebarHoverColor(comp);

    const modal = document.createElement('div');
    modal.className = 'drilldown-modal guest-claim-modal';
    modal.style.backgroundColor = colors.nav;

    const header = document.createElement('div');
    header.className = 'drilldown-modal-header';
    const title = document.createElement('span');
    title.className = 'guest-claim-title';
    title.textContent = 'Were you one of our past players?';
    header.appendChild(title);
    const closeButton = document.createElement('button');
    closeButton.className = 'sidebar-close';
    closeButton.setAttribute('aria-label', 'Close');
    closeButton.innerHTML = '<i class="material-icons">close</i>';
    wireButtonHover(closeButton, chromeHoverColor);
    header.appendChild(closeButton);
    modal.appendChild(header);

    const body = document.createElement('div');
    body.className = 'drilldown-modal-body';

    const intro = document.createElement('p');
    intro.textContent = 'These predictions were imported from before this app existed. If one of them is yours, pick it below and the admin will confirm and link it to your account.';
    body.appendChild(intro);

    const list = document.createElement('div');
    list.className = 'guest-claim-list';
    identities.forEach((identity) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'sidebar-account-btn';
        // Content action buttons always hover to `score`, on every
        // competition - matches admin.html/profile.html's equivalents.
        wireButtonHover(button, colors.score);
        const seasonsText = identity.seasons
            .map((season) => `${getColors(season.competition).name} ${seasonLabel(season.seasonYear)}`)
            .join(', ');
        button.textContent = `${identity.displayName} — ${seasonsText}`;
        button.addEventListener('click', async () => {
            try {
                await requestGuestClaim(user.id, identity.guestKey);
                showNotification('Request sent — manage this anytime from your Profile');
            } catch (err) {
                console.error('Failed to send claim request:', err);
                showNotification('Something went wrong — please try again');
            }
            closePrompt(overlay, modal);
        });
        list.appendChild(button);
    });
    body.appendChild(list);

    const noneButton = document.createElement('button');
    noneButton.type = 'button';
    noneButton.className = 'sidebar-account-btn';
    noneButton.textContent = "None of these are me";
    wireButtonHover(noneButton, colors.score);
    noneButton.addEventListener('click', async () => {
        try {
            await dismissGuestClaimPrompt(user.id);
            showNotification('Got it — you can propose this anytime from your Profile');
        } catch (err) {
            console.error('Failed to dismiss guest claim prompt:', err);
        }
        closePrompt(overlay, modal);
    });
    body.appendChild(noneButton);

    modal.appendChild(body);

    closeButton.addEventListener('click', () => closePrompt(overlay, modal));
    overlay.addEventListener('click', () => closePrompt(overlay, modal));

    document.body.append(overlay, modal);
}

export async function maybeShowGuestClaimPrompt(user) {
    if (hasCheckedThisPageLoad || !user) return;
    hasCheckedThisPageLoad = true;

    try {
        const alreadyMerged = await hasCompletedGuestMerge(user.id);
        if (alreadyMerged) return; // already linked - any further merge is an admin-only action now

        const [dismissed, pendingRequest, unclaimed] = await Promise.all([
            hasDismissedGuestClaimPrompt(user.id),
            getMyPendingClaimRequest(user.id),
            listUnclaimedGuestIdentities(),
        ]);
        if (dismissed || pendingRequest || unclaimed.length === 0) return;
        buildModal(user, unclaimed);
    } catch (err) {
        console.error('Failed to check guest claim status:', err);
    }
}
