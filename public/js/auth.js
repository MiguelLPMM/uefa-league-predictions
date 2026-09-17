// Thin wrapper around Supabase Auth so pages don't talk to supabaseClient
// directly for sign-in/out. Google is the only provider — see the project
// plan for why the OAuth app is left unverified/public rather than gated to a
// test-user allowlist.
import { supabaseClient } from './supabaseClient.js';

export async function getCurrentUser() {
    const { data, error } = await supabaseClient.auth.getUser();
    if (error) {
        // Expected when signed out — not worth logging as an error.
        return null;
    }
    return data.user;
}

// Calls `callback(user)` immediately with the current session (or null), and
// again every time auth state changes (sign in, sign out, token refresh).
// supabase-js fires this callback once right away with the current session
// (event 'INITIAL_SESSION') when you first subscribe, so there's no need to
// separately call getCurrentUser() first — doing so as well was a redundant
// network round-trip that could race with this one and briefly show stale state.
export function onAuthStateChange(callback) {
    supabaseClient.auth.onAuthStateChange((_event, session) => {
        callback(session ? session.user : null);
    });
}

// signInWithOAuth does a full-page redirect to Google and back — the whole
// JS context (including any in-memory "was I signed in a moment ago?" state)
// gets torn down and reloaded fresh. sessionStorage is what survives that
// round trip, so the destination page can tell "I just finished signing in"
// apart from "I loaded and happened to already have a session" and show a
// toast accordingly (see nav.js).
const OAUTH_PENDING_KEY = 'oauthSignInPending';

export async function signInWithGoogle() {
    try {
        sessionStorage.setItem(OAUTH_PENDING_KEY, '1');
    } catch (err) {
        // Best effort - worst case just the post-sign-in toast is missed.
    }

    // Strip any existing hash before using this as the redirect target. If
    // the current URL already ends in a stray '#' (e.g. left over from a
    // previous sign-in's token cleanup), Supabase's server appends
    // '#access_token=...' on top of it unconditionally on the way back,
    // producing a broken '##access_token=...' URL the client can't parse —
    // which silently fails sign-in. A fresh sign-in redirect should never
    // carry hash data anyway, so this is safe regardless of the exact cause.
    const redirectTo = window.location.href.split('#')[0];

    await supabaseClient.auth.signInWithOAuth({
        provider: 'google',
        // Bring the user back to exactly the page (and ?comp=) they started
        // sign-in from.
        options: { redirectTo },
    });
}

// Reads and clears the "sign-in in progress" flag — call once when handling
// the first auth-state update after a page load.
export function consumePendingSignInFlag() {
    try {
        const pending = sessionStorage.getItem(OAUTH_PENDING_KEY) === '1';
        sessionStorage.removeItem(OAUTH_PENDING_KEY);
        return pending;
    } catch (err) {
        return false;
    }
}

export async function signOut() {
    await supabaseClient.auth.signOut();
}
