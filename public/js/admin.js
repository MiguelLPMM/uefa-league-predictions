// Entry script for admin.html. Shared chrome (theme, competition switcher,
// hamburger sidebar/auth) plus a client-side gate on the page content — real
// enforcement of who can actually write admin data lives server-side in the
// RPCs (see adminConfig.js and the SQL migrations); this is purely so a
// non-admin visitor doesn't see admin content/UI at all.
import { applySharedTheme } from './theme.js';
import { syncUrlToSelectedComp, wireCompButtons, linkWithComp } from './compSelector.js';
import { setupNav } from './nav.js';
import { onAuthStateChange } from './auth.js';
import { isAdminUser } from './adminConfig.js';
import { queueNotificationForNextPage } from './notify.js';

// Tracks whether this page load has *ever* seen an admin session, so the
// gate can tell "never had access" apart from "had access, then signed out".
// One-way (true and stays true) rather than tracking the *previous* call's
// result — Supabase's onAuthStateChange can fire more than one event around
// a sign-out, and a plain "previous" flag would get reset to false by the
// first non-admin call, wrongly treating a second one as a fresh visit again.
let hasEverBeenConfirmedAdmin = false;

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
        return;
    }

    // Only explain *why* for a fresh non-admin visit. An actual sign-out
    // transition already gets its own "Signed out" toast from nav.js's
    // updateAccountUI (which, like this, survives the redirect via
    // notify.js's sessionStorage queue) — queuing a second message here
    // would just overwrite that more relevant one.
    if (!hasEverBeenConfirmedAdmin) {
        queueNotificationForNextPage('Admin access required');
    }
    window.location.replace(linkWithComp('leaderboard.html'));
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
