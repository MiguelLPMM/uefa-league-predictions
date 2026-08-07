// api/matches/[comp].js
const { getMatches } = require('uefa-api');

// Season variable updating each September
function getSeasonYear() {
    const currentDate = new Date();
    const currentYear = currentDate.getFullYear();
    return currentDate.getMonth() >= 8 ? currentYear + 1 : currentYear;
}

const COMPETITIONS = {
    ucl: { competitionId: 1, limit: 238, label: 'Champions League' },
    uel: { competitionId: 14, limit: 234, label: 'Europa League' },
    uecl: { competitionId: 2019, limit: 364, label: 'Conference League' },
};

module.exports = async (req, res) => {
    const { comp } = req.query;
    const competition = COMPETITIONS[comp];

    if (!competition) {
        res.status(404).json({ error: 'Unknown competition' });
        return;
    }

    try {
        const matches = await getMatches({
            competitionId: competition.competitionId,
            seasonYear: getSeasonYear(),
        }, 'ASC', competition.limit);

        const groupStageMatches = matches.filter(match => match.type === 'GROUP_STAGE');

        res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
        res.status(200).json(groupStageMatches);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: `Error fetching ${competition.label} matches` });
    }
};
