// The self-serve "is this you" prompt for guest (no-account) historical
// entries. Runs once per page load for a signed-in user - wired from
// nav.js's setupNav() so it applies on every page without each page having
// to remember to include it. The modal is built entirely in JS (no markup
// to add to every HTML file), reusing the same classes as the drill-down
// modal/sidebar for visual consistency.
import { getColors } from './theme.js';
import {
    listUnclaimedGuestIdentities,
    getMyGuestClaimRequests,
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

    const modal = document.createElement('div');
    modal.className = 'drilldown-modal guest-claim-modal';

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
        const seasonsText = identity.seasons
            .map((season) => `${getColors(season.competition).name} ${seasonLabel(season.seasonYear)}`)
            .join(', ');
        button.textContent = `${identity.displayName} — ${seasonsText}`;
        button.addEventListener('click', async () => {
            try {
                await requestGuestClaim(user.id, identity.guestKey);
                showNotification('Request sent — the admin will review it');
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
    noneButton.addEventListener('click', async () => {
        try {
            await dismissGuestClaimPrompt(user.id);
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
        const [dismissed, myRequests, unclaimed] = await Promise.all([
            hasDismissedGuestClaimPrompt(user.id),
            getMyGuestClaimRequests(user.id),
            listUnclaimedGuestIdentities(),
        ]);
        if (dismissed || myRequests.length > 0 || unclaimed.length === 0) return;
        buildModal(user, unclaimed);
    } catch (err) {
        console.error('Failed to check guest claim status:', err);
    }
}
