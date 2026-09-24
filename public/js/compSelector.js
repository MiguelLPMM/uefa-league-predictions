// Keeps the selected competition (ucl/uel/uecl) in sync across the URL's
// ?comp= query param and localStorage, so it survives both a page reload and
// navigating between the Predictions/Leaderboard/Admin pages. The URL param
// takes priority (so a shared link like /leaderboard?comp=uel always wins
// on load), falling back to the last-used value in localStorage, and finally
// to 'ucl'.
const STORAGE_KEY = 'selectedComp';
const VALID_COMPS = ['ucl', 'uel', 'uecl'];

// True while the URL still holds Google/Supabase's OAuth callback data (an
// implicit-flow #access_token=... hash, or a PKCE ?code=...&state=... pair).
// Supabase's client needs to read that itself and then strips it via its own
// history.replaceState call — if our replaceState calls run first (or race
// with it), they can interfere with Supabase completing sign-in. So: while
// this is true, resolve the competition as usual but never touch the URL.
function isOAuthCallbackInProgress() {
    if (/access_token=|error=/.test(window.location.hash)) {
        return true;
    }
    const params = new URLSearchParams(window.location.search);
    return params.has('code') && params.has('state');
}

export function getSelectedComp() {
    const url = new URL(window.location.href);
    const fromUrl = url.searchParams.get('comp');
    if (VALID_COMPS.includes(fromUrl)) {
        return fromUrl;
    }
    try {
        const fromStorage = localStorage.getItem(STORAGE_KEY);
        if (VALID_COMPS.includes(fromStorage)) {
            return fromStorage;
        }
    } catch (err) {
        console.error('Failed to read selected competition:', err);
    }
    return 'ucl';
}

// Updates localStorage + the current URL (without reloading) and notifies the
// page that the competition changed, via a 'comp-changed' event.
export function setSelectedComp(comp) {
    if (!VALID_COMPS.includes(comp)) return;

    try {
        localStorage.setItem(STORAGE_KEY, comp);
    } catch (err) {
        console.error('Failed to save selected competition:', err);
    }

    if (!isOAuthCallbackInProgress()) {
        rewriteUrl(comp);
    }

    window.dispatchEvent(new CustomEvent('comp-changed', { detail: { comp } }));
}

// Resolves the competition to use on initial page load (URL, then
// localStorage, then 'ucl') and makes sure the URL reflects it, even if the
// page was opened without a ?comp= param.
export function syncUrlToSelectedComp() {
    const comp = getSelectedComp();
    if (!isOAuthCallbackInProgress()) {
        rewriteUrl(comp);
    }
    return comp;
}

// Writes ?comp=<comp> into the URL and strips any hash fragment. A bare
// trailing '#' can be left behind after Supabase's own OAuth-callback
// cleanup (setting a hash to '' doesn't always remove the '#' character
// itself, a long-standing browser quirk) — note `url.hash` normalizes to ''
// even when one is present, so checking the raw href is what actually
// detects it. Only called once we already know no real callback is in
// progress (see isOAuthCallbackInProgress).
function rewriteUrl(comp) {
    const url = new URL(window.location.href);
    const needsCompUpdate = url.searchParams.get('comp') !== comp;
    const needsHashCleanup = window.location.href.includes('#');
    if (needsCompUpdate || needsHashCleanup) {
        url.searchParams.set('comp', comp);
        url.hash = '';
        window.history.replaceState({}, '', url);
    }
}

// Wires every .comp-button on the page to update the selected competition.
export function wireCompButtons() {
    document.querySelectorAll('.comp-button').forEach((button) => {
        button.addEventListener('click', () => {
            setSelectedComp(button.getAttribute('data-arg'));
        });
    });
}

// Builds a same-site link that carries the currently selected competition
// along as a query param, e.g. linkWithComp('/leaderboard') ->
// '/leaderboard?comp=uel'.
export function linkWithComp(path) {
    return `${path}?comp=${getSelectedComp()}`;
}
