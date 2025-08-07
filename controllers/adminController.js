const { addCreditsService } = require('../services/adminService');

const addCredits = async (req, res) => {
    try {
        const { githubId, amount } = req.body;
        const result = await addCreditsService(githubId, amount);
        res.json(result);
    } catch (error) {
        if (error.message === 'User not found') {
            return res.status(404).json({ error: error.message });
        }
        res.status(500).json({ error: 'Server error' });
    }
};

module.exports = {
    addCredits
};
