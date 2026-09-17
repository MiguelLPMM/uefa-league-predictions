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
    if (hamburgerButton) hamburgerButton.style.backgroundColor = colors.nav;

    const sidebar = document.getElementById('sidebar');
    if (sidebar) sidebar.style.backgroundColor = colors.nav;

    // The toast notification (notify.js) is shared by every page too.
    const notification = document.getElementById('notification');
    if (notification) notification.style.backgroundColor = colors.nav;

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
