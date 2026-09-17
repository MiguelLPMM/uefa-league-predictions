// api/matches/[comp].js
const { COMPETITIONS, fetchCompetitionMatches } = require('../_lib/uefaMatches');

module.exports = async (req, res) => {
    const { comp } = req.query;
    const competition = COMPETITIONS[comp];

    if (!competition) {
        res.status(404).json({ error: 'Unknown competition' });
        return;
    }

    try {
        const groupStageMatches = await fetchCompetitionMatches(comp);

        res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
        res.status(200).json(groupStageMatches);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: `Error fetching ${competition.label} matches` });
    }
};
