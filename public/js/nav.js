// Hamburger sidebar: navigation links, competition-aware hrefs, and the
// sign-in/out account section. Shared across every page (predicting,
// leaderboard, admin) — each page's own entry script imports and calls
// setupNav() once.
import { getCurrentUser, onAuthStateChange, signInWithGoogle, signOut, consumePendingSignInFlag } from './auth.js';
import { isAdminUser } from './adminConfig.js';
import { linkWithComp, syncUrlToSelectedComp } from './compSelector.js';
import { showNotification, resumeQueuedNotification } from './notify.js';
import { maybeShowGuestClaimPrompt } from './guestClaimPrompt.js';
import { createBlankAvatar } from './avatar.js';

// Tracks the previously-seen user id so a toast only fires on an actual
// sign-in/out transition, not on every page load's initial auth check
// (undefined = "we don't know yet", distinct from null = "signed out").
let previousUserId;

// So a later comp-changed event can re-resolve the admin link's href without
// needing a fresh auth round-trip - see updateAdminLinkVisibility below.
let latestUser;

function updateNavLinks() {
    const predictionsLink = document.getElementById('nav-predictions');
    const leaderboardLink = document.getElementById('nav-leaderboard');
    const profileLink = document.getElementById('sidebar-profile-link');
    if (predictionsLink) predictionsLink.href = linkWithComp('/');
    if (leaderboardLink) leaderboardLink.href = linkWithComp('/leaderboard');
    if (profileLink) profileLink.href = linkWithComp('/profile');

    // Mark whichever link matches the current page as active. Pages live at
    // clean URLs ('/', '/leaderboard'); a stray '.html' or trailing slash
    // (e.g. a local static server) is normalized away before comparing.
    const normalize = (path) => (path.replace(/\.html$/, '').replace(/\/index$/, '/').replace(/(.)\/$/, '$1') || '/');
    const currentPage = normalize(window.location.pathname);
    [predictionsLink, leaderboardLink].forEach((link) => {
        if (!link) return;
        const linkPage = normalize(link.getAttribute('href').split('?')[0]);
        link.classList.toggle('active', linkPage === currentPage);
    });
}

function updateAdminLinkVisibility(user) {
    const adminLink = document.getElementById('nav-admin');
    if (!adminLink) return;
    adminLink.hidden = !isAdminUser(user);
    if (!adminLink.hidden) {
        adminLink.href = linkWithComp('/admin');
    }
}

function updateAccountUI(user) {
    latestUser = user;
    const signInButton = document.getElementById('sidebar-signin');
    const userBox = document.getElementById('sidebar-user');
    const nameEl = document.getElementById('sidebar-user-name');
    const avatarEl = document.getElementById('sidebar-user-avatar');

    if (!signInButton || !userBox) return;

    let displayName = '';

    if (user) {
        signInButton.hidden = true;
        userBox.hidden = false;
        const meta = user.user_metadata || {};
        displayName = meta.full_name || meta.name || user.email || 'Signed in';
        if (nameEl) nameEl.textContent = displayName;
        if (avatarEl) {
            let blankEl = document.getElementById('sidebar-user-avatar-blank');
            if (!blankEl) {
                blankEl = createBlankAvatar();
                blankEl.id = 'sidebar-user-avatar-blank';
                avatarEl.after(blankEl);
            }
            if (meta.avatar_url) {
                // no-referrer: see createAvatar in avatar.js
                avatarEl.referrerPolicy = 'no-referrer';
                avatarEl.src = meta.avatar_url;
                avatarEl.style.display = '';
                blankEl.hidden = true;
            } else {
                avatarEl.style.display = 'none';
                blankEl.hidden = false;
            }
        }
    } else {
        signInButton.hidden = false;
        userBox.hidden = true;
    }

    const currentUserId = user ? user.id : null;
    // A real sign-in/out while already on the page, OR the first check after
    // an OAuth redirect just completed (previousUserId resets to "unknown" on
    // every page load, so that alone can't distinguish "just signed in" from
    // "loaded already signed in").
    const justCompletedOAuthSignIn = Boolean(currentUserId) && consumePendingSignInFlag();
    if (justCompletedOAuthSignIn) {
        // Supabase notifies this listener as part of processing its callback
        // data (token hash / code+state), which happens *before* it strips
        // that data from the URL itself — so cleaning up right now would
        // still see the real token and correctly back off (see
        // isOAuthCallbackInProgress in compSelector.js), but nothing would
        // ever run a second pass afterward. Deferring a tick reliably lands
        // after Supabase's own cleanup instead of racing it.
        setTimeout(() => syncUrlToSelectedComp(), 150);
    }
    if (justCompletedOAuthSignIn || (previousUserId !== undefined && currentUserId !== previousUserId)) {
        showNotification(currentUserId ? `Signed in as ${displayName}` : 'Signed out');
    }
    previousUserId = currentUserId;

    updateAdminLinkVisibility(user);
    maybeShowGuestClaimPrompt(user);
}

function openSidebar() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    const toggle = document.getElementById('hamburger-toggle');
    if (!sidebar) return;
    updateNavLinks();
    sidebar.classList.add('open');
    sidebar.setAttribute('aria-hidden', 'false');
    if (overlay) overlay.hidden = false;
    if (toggle) toggle.setAttribute('aria-expanded', 'true');
}

function closeSidebar() {
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebar-overlay');
    const toggle = document.getElementById('hamburger-toggle');
    if (!sidebar) return;
    sidebar.classList.remove('open');
    sidebar.setAttribute('aria-hidden', 'true');
    if (overlay) overlay.hidden = true;
    if (toggle) toggle.setAttribute('aria-expanded', 'false');
}

export function setupNav() {
    const toggle = document.getElementById('hamburger-toggle');
    const closeButton = document.getElementById('sidebar-close');
    const overlay = document.getElementById('sidebar-overlay');
    const signInButton = document.getElementById('sidebar-signin');
    const signOutButton = document.getElementById('sidebar-signout');

    if (toggle) toggle.addEventListener('click', openSidebar);
    if (closeButton) closeButton.addEventListener('click', closeSidebar);
    if (overlay) overlay.addEventListener('click', closeSidebar);
    if (signInButton) signInButton.addEventListener('click', signInWithGoogle);
    if (signOutButton) signOutButton.addEventListener('click', signOut);

    updateNavLinks();
    window.addEventListener('comp-changed', () => {
        updateNavLinks();
        updateAdminLinkVisibility(latestUser);
    });

    resumeQueuedNotification();
    onAuthStateChange(updateAccountUI);

    // Exposed so page-specific scripts (e.g. admin.js) can gate their own
    // content on the same auth state without a second Supabase round-trip.
    return { getCurrentUser };
}
