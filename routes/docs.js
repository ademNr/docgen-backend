const express = require('express');
const {
    generateDocs,
    getGenerateProgress
} = require('../controllers/docsController');
const { authenticateToken, authenticateUser } = require('../middleware/auth');
const { validateGenerateDocs, validateProgressQuery } = require('../middleware/validation');
const { docsLimiter } = require('../middleware/security');
const { asyncHandler } = require('../middleware/errorHandler');

const router = express.Router();

router.post('/generate',
    docsLimiter,
    authenticateToken,
    validateGenerateDocs,
    authenticateUser,
    asyncHandler(generateDocs)
);

// Make sure this route doesn't have authentication middleware that might interfere
router.get('/generate-progress',
    validateProgressQuery,
    getGenerateProgress // Don't wrap with asyncHandler for EventSource
);

module.exports = router;
