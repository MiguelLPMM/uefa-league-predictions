// A person's photo, or a plain circle of the same size when they have none (guests, accounts
// without a picture) or when the photo fails to load - so names stay lined up everywhere.
// The size comes from the surrounding CSS (see .avatar-blank and the per-context img rules).
// A <div>, not a <span>, on purpose: several containers style every child <span> as flexible text.
export function createBlankAvatar() {
    const blank = document.createElement('div');
    blank.className = 'avatar-blank';
    blank.setAttribute('aria-hidden', 'true');
    return blank;
}

export function createAvatar(url) {
    if (!url) return createBlankAvatar();

    const img = document.createElement('img');
    // Google's avatar CDN sometimes stalls/fails when it sees a referrer from a third-party
    // origin - dropping it entirely is what fixes the intermittent "doesn't load for a while".
    img.referrerPolicy = 'no-referrer';
    img.alt = '';
    img.addEventListener('error', () => img.replaceWith(createBlankAvatar()), { once: true });
    img.src = url;
    return img;
}
