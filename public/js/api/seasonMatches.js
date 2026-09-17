// Admin-only helper: fetches a specific season's real match data straight
// from the UEFA API (via api/admin/season-matches.js) so the admin panel can
// use real team ids/names/logos instead of free-typed text - this is what
// keeps a guest import's predicted-rank team ids consistent with whatever
// the real actual standings will use later (they come from the exact same
// source), and is what makes historical seasons' logos work at all.
export async function fetchSeasonMatches(competition, seasonYear) {
    const response = await fetch(`/api/admin/season-matches?comp=${competition}&season=${seasonYear}`);
    if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error || `Failed to fetch ${competition} ${seasonYear} matches`);
    }
    return response.json();
}

// The distinct 36-team roster for a season, derived from its match list -
// works whether the season is finished or still in progress.
export function deriveRoster(matches) {
    const rosterById = new Map();
    matches.forEach((match) => {
        if (match.homeTeam) {
            rosterById.set(match.homeTeam.id, { id: match.homeTeam.id, name: match.homeTeam.internationalName, logo: match.homeTeam.logoUrl });
        }
        if (match.awayTeam) {
            rosterById.set(match.awayTeam.id, { id: match.awayTeam.id, name: match.awayTeam.internationalName, logo: match.awayTeam.logoUrl });
        }
    });
    return Array.from(rosterById.values()).sort((a, b) => a.name.localeCompare(b.name));
}
