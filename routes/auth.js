const express = require('express');
const { githubAuth } = require('../controllers/authController');
const { validateGithubAuth } = require('../middleware/validation');
const { authLimiter } = require('../middleware/security');
const { asyncHandler } = require('../middleware/errorHandler');

const router = express.Router();

router.post('/github',
    authLimiter,
    validateGithubAuth,
    asyncHandler(githubAuth)
);

module.exports = router;
