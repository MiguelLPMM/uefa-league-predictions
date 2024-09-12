// index.js
const express = require('express');
const path = require('path');
const { getMatches } = require('uefa-api');

const app = express();

// Middleware to parse JSON data
app.use(express.json());
app.use(express.static('public'));

// Routes to fetch matches from the API
app.get('/api/matches/ucl', async (req, res) => {
    try {
        const matches = await getMatches({
            competitionId: 1,  // UEFA Champions League
            seasonYear: 2025,
        }, 'ASC', 234);
        // Filter out matches based on type and round
        const groupStageMatches = matches.filter(match =>
            match.type === 'GROUP_STAGE'
        );
        res.json(groupStageMatches);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error fetching Champions League matches' });
    }
});

app.get('/api/matches/uel', async (req, res) => {
    try {
        const matches = await getMatches({
            competitionId: 14,  // UEFA Europa League
            seasonYear: 2025,
        }, 'ASC', 234);
        // Filter out matches based on type and round
        const groupStageMatches = matches.filter(match =>
            match.type === 'GROUP_STAGE'
        );
        res.json(groupStageMatches);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error fetching Europa League matches' });
    }
});

app.get('/api/matches/uecl', async (req, res) => {
    try {
        const matches = await getMatches({
            competitionId: 2019,  // UEFA European Conference League
            seasonYear: 2025,
        }, 'ASC', 234);
        // Filter out matches based on type and round
        const groupStageMatches = matches.filter(match =>
            match.type === 'GROUP_STAGE'
        );
        res.json(groupStageMatches);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error fetching Conference League matches' });
    }
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
