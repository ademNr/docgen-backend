const { githubAuthService } = require('../services/authService');

const githubAuth = async (req, res) => {
    try {
        const { code } = req.body;

        if (!code) {
            return res.status(400).json({ error: 'Authorization code is required' });
        }

        const result = await githubAuthService(code);
        res.json(result);
    } catch (error) {
        console.error('GitHub auth error:', error.message);
        res.status(500).json({
            error: 'Authentication service unavailable',
            details: error.message
        });
    }
};

module.exports = {
    githubAuth
};
