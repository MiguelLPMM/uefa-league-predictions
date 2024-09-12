// index.js
const express = require('express');
const path = require('path');
const { getMatches } = require('uefa-api');

const app = express();

// Middleware to parse JSON data
app.use(express.json());
app.use(express.static('docs'));

// Route to fetch matches from the API
app.get('/api/matches', async (req, res) => {
    try {
        const uclMatches = await getMatches({
            competitionId: 1,  // UEFA Champions League
            seasonYear: 2025,
        }, 'ASC', 234);
        // Filter out matches based on type and round
        const uclGroupStageMatches = uclMatches.filter(match =>
            match.type === 'GROUP_STAGE'
        );
        res.json(uclGroupStageMatches);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error fetching matches' });
    }
});

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});
