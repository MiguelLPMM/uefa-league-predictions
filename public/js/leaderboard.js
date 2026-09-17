// Entry script for leaderboard.html. Just the shared chrome for now (theme,
// competition switcher, hamburger sidebar/auth) — the actual leaderboard
// views are built in later phases.
import { applySharedTheme } from './theme.js';
import { syncUrlToSelectedComp, wireCompButtons } from './compSelector.js';
import { setupNav } from './nav.js';

document.addEventListener('DOMContentLoaded', () => {
    wireCompButtons();
    window.addEventListener('comp-changed', (event) => applySharedTheme(event.detail.comp));

    setupNav();

    applySharedTheme(syncUrlToSelectedComp());

    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/sw.js');
    }
});
