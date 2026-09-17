// Shared toast notification — originally lived only in main.js (used for
// "Standings copied to clipboard!"/"Predictions cleared!"), pulled out so
// every page can show one too.
//
// Every notification also persists its remaining show-time to sessionStorage.
// If something navigates away (e.g. the admin gate redirecting a non-admin,
// or even an ordinary link click) while a toast is mid-display, the toast
// would otherwise just vanish with the old page — instead, the destination
// page's setupNav() calls resumeQueuedNotification(), which picks it back up
// for whatever time was left.
const QUEUE_KEY = 'queuedNotification'; // JSON: { message, showUntil: epoch-ms }
const DEFAULT_DURATION_MS = 3000;

let notificationTimeout;

function renderNotification(message, durationMs) {
    const notification = document.getElementById('notification');
    if (!notification) return; // page doesn't have a notification element

    notification.textContent = message;
    notification.style.display = 'block';

    if (notificationTimeout) {
        clearTimeout(notificationTimeout);
    }

    notificationTimeout = setTimeout(() => {
        notification.style.display = 'none';
    }, durationMs);
}

export function showNotification(message, durationMs = DEFAULT_DURATION_MS) {
    try {
        sessionStorage.setItem(QUEUE_KEY, JSON.stringify({ message, showUntil: Date.now() + durationMs }));
    } catch (err) {
        // Best effort - worst case this one toast can't survive a navigation.
    }
    renderNotification(message, durationMs);
}

// For a message that should only ever appear on the *next* page (e.g. the
// admin gate redirecting a non-admin away) - the current page is about to be
// torn down, so there's no point trying to render it here at all.
export function queueNotificationForNextPage(message, durationMs = DEFAULT_DURATION_MS) {
    try {
        sessionStorage.setItem(QUEUE_KEY, JSON.stringify({ message, showUntil: Date.now() + durationMs }));
    } catch (err) {
        // Best effort - worst case this one toast is silently lost.
    }
}

// Call once per page load (done inside setupNav(), so every page gets this
// for free) to resume any notification queued or interrupted by whatever
// page navigated here, for however much of its display time was left.
export function resumeQueuedNotification() {
    try {
        const raw = sessionStorage.getItem(QUEUE_KEY);
        if (!raw) return;
        sessionStorage.removeItem(QUEUE_KEY);
        const { message, showUntil } = JSON.parse(raw);
        const remaining = showUntil - Date.now();
        if (remaining > 200) { // otherwise it's already effectively expired
            renderNotification(message, remaining);
        }
    } catch (err) {
        // Malformed/missing entry - nothing to resume.
    }
}
