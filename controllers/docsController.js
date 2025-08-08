const { generateDocsService } = require('../services/docsService');

const generateDocs = async (req, res) => {
    try {
        const { owner, repo, includeTests = false } = req.body;
        const user = req.user;
        const token = req.token;

        const result = await generateDocsService({
            user,
            token,
            owner,
            repo,
            includeTests
        });

        res.json(result);
    } catch (error) {
        let status = 500;
        if (error.message === 'Insufficient credits') {
            status = 402;
        } else if (error.status === 404) {
            status = 404;
        } else if (error.status === 401) {
            status = 401;
        }

        res.status(status).json({
            error: error.message,
            lifeTimePlan: req.user?.lifeTimePlan || false
        });
    }
};

module.exports = {
    generateDocs
};
