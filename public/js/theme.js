// Per-competition color scheme, shared by every page (predicting, leaderboard,
// admin) so the nav bar, hamburger sidebar, favicon and title all stay in sync
// with whichever competition is selected — moved out of main.js so pages other
// than the predicting page can use it too.
export const colorSchemes = {
    ucl: {
        background: '#000040',
        nav: '#0230f7',         // copy button background, notification
        top8: '#17177a',
        match: '#0a0a61',       // comp/copy button hover, top 24, input background
        score: '#00eeff',
        finished: '#606098',
        icon: 'assets/ucl.ico',
        name: 'Champions'
    },
    uel: {
        background: 'black',
        nav: 'black',
        top8: '#3a3a3c',
        match: '#1c1c1e',
        score: '#ff6900',
        finished: '#555556',
        icon: 'assets/uel.ico',
        name: 'Europa'
    },
    uecl: {
        background: 'black',
        nav: 'black',
        top8: '#3a3a3c',
        match: '#1c1c1e',
        score: '#00be14',
        finished: '#555556',
        icon: 'assets/uecl.ico',
        name: 'Conference'
    }
};

export function getColors(comp) {
    return colorSchemes[comp] || colorSchemes.ucl;
}

// A native <select>'s open dropdown list mostly ignores CSS (the browser's
// own UI draws it), but per-<option> background/color IS respected, and
// re-applying it on every 'change' keeps the currently-selected row colored
// too - closest a plain <select> gets to matching the rest of the theme
// instead of the browser's default blue. Exported so pages that build a
// themed <select> dynamically (e.g. admin.js's manual-merge picker, built
// after a "Find user" click rather than present at page load) can theme it
// the same way applySharedTheme does for the ones already in the DOM.
export function themeSelectOptions(select, baseColor, selectedColor) {
    const applyOptionColors = () => {
        Array.from(select.options).forEach(option => {
            option.style.backgroundColor = option.value === select.value ? selectedColor : baseColor;
            option.style.color = 'white';
        });
    };
    applyOptionColors();
    select.addEventListener('change', applyOptionColors);
}

// `.sidebar-account-btn`/`.sidebar-user-link`'s hover color, wherever that
// class is reused (the actual sidebar, or admin/profile action buttons) -
// `match` is near-identical to `nav`/`background` for uel/uecl, so those two
// fall back to the vivid `score` instead; ucl keeps `match`.
export function getSidebarHoverColor(comp) {
    const colors = getColors(comp);
    return comp === 'ucl' ? colors.match : colors.score;
}

// Wires the mouseover/mouseout hover-color swap used throughout this file,
// exported so a page that builds a `.sidebar-account-btn`-styled element
// dynamically (admin.js's Approve/Reject/Merge buttons, profile.js's
// identity/cancel buttons, guestClaimPrompt.js's modal buttons) can wire the
// same behavior at creation time - applySharedTheme's own sweep only ever
// reaches elements that already existed in the DOM when it last ran.
export function wireButtonHover(el, hoverColor) {
    el.addEventListener('mouseover', () => {
        el.style.backgroundColor = hoverColor;
    });
    el.addEventListener('mouseout', () => {
        el.style.backgroundColor = '';
    });
}

// Applies the parts of the color scheme every page shares: body background,
// nav bar, competition buttons, hamburger/sidebar, favicon, and the page
// title/header. Page-specific styling (score inputs, standings table rows,
// etc.) stays in that page's own script.
export function applySharedTheme(comp) {
    const colors = getColors(comp);

    document.body.style.backgroundColor = colors.background;

    const navBar = document.querySelector('nav');
    if (navBar) navBar.style.backgroundColor = colors.nav;

    const hamburgerButton = document.getElementById('hamburger-toggle');

    const sidebar = document.getElementById('sidebar');
    if (sidebar) sidebar.style.backgroundColor = colors.nav;

    // The toast notification (notify.js) is shared by every page too.
    const notification = document.getElementById('notification');
    if (notification) notification.style.backgroundColor = colors.nav;

    // Navbar hover (hamburger, comp-buttons) always stays on `match` - that
    // was already the behavior before this round of theming work and it's
    // fine on every competition, so it's not touched here.
    if (hamburgerButton) {
        hamburgerButton.style.backgroundColor = colors.nav;
        hamburgerButton.addEventListener('mouseover', () => {
            hamburgerButton.style.backgroundColor = colors.match;
        });
        hamburgerButton.addEventListener('mouseout', () => {
            hamburgerButton.style.backgroundColor = colors.nav;
        });
    }

    // Apply color scheme to competition buttons (shared across every page)
    const compButtons = document.querySelectorAll('.comp-button');
    compButtons.forEach(button => {
        button.style.backgroundColor = colors.nav;
        button.addEventListener('mouseover', () => {
            button.style.backgroundColor = colors.match;
        });
        button.addEventListener('mouseout', () => {
            button.style.backgroundColor = colors.nav;
        });
    });

    // Sidebar hover/active backgrounds - a plain CSS `:hover` rule can't use
    // the per-competition palette, so (like .comp-button above) these are
    // driven from here instead of a hardcoded color in style.css. Unlike the
    // navbar above, `match` here is near-identical to `nav`/`background` for
    // uel/uecl (both close to black), making the highlight all but invisible
    // - so only the sidebar falls back to the vivid `score` color for those
    // two, while ucl keeps `match` (score there is bright cyan, too low-
    // contrast against the sidebar's white text).
    const sidebarHoverColor = getSidebarHoverColor(comp);
    const sidebarNavLinks = document.querySelectorAll('.sidebar-links a');
    sidebarNavLinks.forEach(link => {
        link.style.backgroundColor = link.classList.contains('active') ? sidebarHoverColor : '';
        link.addEventListener('mouseover', () => {
            link.style.backgroundColor = sidebarHoverColor;
        });
        link.addEventListener('mouseout', () => {
            link.style.backgroundColor = link.classList.contains('active') ? sidebarHoverColor : '';
        });
    });

    const sidebarButtonsAndLinks = document.querySelectorAll('.sidebar-account-btn, .sidebar-user-link');
    sidebarButtonsAndLinks.forEach(el => wireButtonHover(el, sidebarHoverColor));

    const sidebarCloseButton = document.getElementById('sidebar-close');
    if (sidebarCloseButton) wireButtonHover(sidebarCloseButton, sidebarHoverColor);

    // Action buttons inside a content panel (admin's Import/Find user, and
    // any equivalent on profile.html) reuse the same `.sidebar-account-btn`
    // class for its look, but always hover to `score` on every competition -
    // unlike the actual sidebar drawer above, there's no white-text-on-cyan
    // contrast problem here to avoid on ucl. Added after the generic sweep
    // above so it wins for the elements both match.
    document.querySelectorAll('.admin-content .sidebar-account-btn').forEach(el => wireButtonHover(el, colors.score));

    // Admin/profile panels ("admin-section") and their form fields - shared
    // by admin.html and profile.html, previously hardcoded to ucl's colors
    // regardless of the selected competition.
    document.querySelectorAll('.admin-section').forEach(section => {
        section.style.backgroundColor = colors.match;
    });
    document.querySelectorAll('.admin-content input[type="text"], .admin-content input[type="email"], .admin-content input[type="number"], .admin-content textarea, .admin-content select, .admin-select').forEach(field => {
        field.style.backgroundColor = colors.top8;
    });
    document.querySelectorAll('.admin-content select, .admin-select').forEach(select => {
        themeSelectOptions(select, colors.top8, colors.score);
    });

    // Leaderboard season selector - also previously hardcoded.
    document.querySelectorAll('.leaderboard-season-bar select').forEach(select => {
        select.style.backgroundColor = colors.match;
        themeSelectOptions(select, colors.match, colors.score);
    });

    // View-tab buttons (Breakdown/Actual Table/Leaderboard) - same stale
    // "overridden elsewhere" comment as the drill-down modal below; nothing
    // ever actually set this, so it always showed ucl's blue. `nav` is fine
    // for ucl (it's what it always was), but it's black for uel/uecl - same
    // as their background - so those two fall back to `score` instead.
    const viewTabColor = comp === 'ucl' ? colors.nav : colors.score;
    document.querySelectorAll('.view-tab').forEach(tab => {
        tab.style.backgroundColor = viewTabColor;
    });

    // Drill-down modal shell - never actually got a per-competition
    // background despite the stale "overridden by callers" CSS comment.
    const drilldownModal = document.getElementById('drilldown-modal');
    if (drilldownModal) drilldownModal.style.backgroundColor = colors.nav;

    // Update the favicon
    const favicon = document.querySelector('link[rel="icon"]');
    if (favicon) favicon.href = colors.icon;

    // Update the header (split across two spans so mobile can force an even
    // "UEFA <Competition>" / "League Predictions" line break instead of
    // wrapping wherever the text happens to run out of room)
    const header = document.getElementById('header');
    if (header) {
        header.innerHTML = '';
        const titlePart1 = document.createElement('span');
        titlePart1.className = 'title-part1';
        titlePart1.textContent = `UEFA ${colors.name}`;
        const titlePart2 = document.createElement('span');
        titlePart2.className = 'title-part2';
        titlePart2.textContent = 'League Predictions';
        header.append(titlePart1, ' ', titlePart2);
    }

    // Update the document title
    document.title = `UEFA ${colors.name} League Predictions`;

    return colors;
}
