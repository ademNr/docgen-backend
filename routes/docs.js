const express = require('express');
const { generateDocs } = require('../controllers/docsController');
const { authenticateToken, authenticateUser } = require('../middleware/auth');
const { validateGenerateDocs } = require('../middleware/validation');
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

module.exports = router;
