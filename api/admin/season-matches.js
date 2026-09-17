// api/admin/season-matches.js
//
// Lets the admin panel pull a *specific* season's real match data (teams,
// logos, results) straight from the UEFA API instead of the admin typing
// team names/final standings by hand - works for past seasons too, which is
// what makes it possible to fetch e.g. 24/25's real final table on demand.
// Same shape as api/matches/[comp].js's response, just parameterized by
// season instead of always "whatever's current".
const { COMPETITIONS, fetchCompetitionMatchesForSeason } = require('../_lib/uefaMatches');

module.exports = async (req, res) => {
    const { comp, season } = req.query;
    const competition = COMPETITIONS[comp];
    const seasonYear = parseInt(season, 10);

    if (!competition) {
        res.status(404).json({ error: 'Unknown competition' });
        return;
    }
    if (!seasonYear) {
        res.status(400).json({ error: 'A numeric season query param is required' });
        return;
    }

    try {
        const matches = await fetchCompetitionMatchesForSeason(comp, seasonYear);
        res.setHeader('Cache-Control', 's-maxage=3600, stale-while-revalidate=86400');
        res.status(200).json(matches);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: `Error fetching ${competition.label} matches for ${seasonYear}` });
    }
};
