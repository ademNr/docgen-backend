const {
    getUserCreditsService,
    getUserReposService,
    updateUserEmailService
} = require('../services/userService');

const getUserCredits = async (req, res) => {
    try {
        const user = req.user;
        const credits = await getUserCreditsService(user);
        res.json(credits);
    } catch (error) {
        console.error('Get user credits error:', error);
        res.status(500).json({ error: 'Server error' });
    }
};

const getUserRepos = async (req, res) => {
    try {
        const token = req.token;

        if (!token) {
            return res.status(401).json({ error: 'No authentication token provided' });
        }

        console.log('Fetching repos with token:', token.substring(0, 10) + '...');

        const repos = await getUserReposService(token);

        console.log(`Successfully fetched ${repos.length} repositories`);
        res.json(repos);
    } catch (error) {
        console.error('Error fetching repositories:', error.message);

        // Return specific error messages to help with debugging
        if (error.message.includes('invalid or expired')) {
            return res.status(401).json({
                error: 'GitHub token expired',
                message: 'Please re-authenticate with GitHub',
                code: 'TOKEN_EXPIRED'
            });
        } else if (error.message.includes('rate limit')) {
            return res.status(429).json({
                error: 'GitHub API rate limit exceeded',
                message: 'Please try again later',
                code: 'RATE_LIMIT'
            });
        } else {
            return res.status(500).json({
                error: 'Failed to fetch repositories',
                message: error.message,
                code: 'FETCH_ERROR'
            });
        }
    }
};

const updateUserEmail = async (req, res) => {
    try {
        const { userId, email } = req.body;

        if (!userId || !email) {
            return res.status(400).json({ error: 'Missing userId or email' });
        }

        const result = await updateUserEmailService(userId, email);
        res.json(result);
    } catch (error) {
        console.error('Email update error:', error);

        if (error.message === 'Invalid email format') {
            return res.status(400).json({ error: error.message });
        }

        if (error.message === 'User not found') {
            return res.status(404).json({ error: error.message });
        }

        res.status(500).json({ error: 'Server error' });
    }
};

module.exports = {
    getUserCredits,
    getUserRepos,
    updateUserEmail
};
