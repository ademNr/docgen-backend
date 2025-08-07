const { processGumroadWebhook } = require('../services/webhookService');

const gumroadWebhook = async (req, res) => {
    try {
        const event = req.body;
        const result = await processGumroadWebhook(event);
        res.json(result);
    } catch (error) {
        console.error('Gumroad webhook error:', error);

        if (error.message === 'Invalid payload') {
            return res.status(400).json({ error: error.message });
        }

        if (error.message === 'User not found') {
            return res.status(404).json({ error: error.message });
        }

        res.status(500).json({ error: 'Internal server error' });
    }
};

module.exports = {
    gumroadWebhook
};
