const express = require('express');
const { gumroadWebhook } = require('../controllers/webhookController');
const { webhookLimiter } = require('../middleware/security');
const { asyncHandler } = require('../middleware/errorHandler');

const router = express.Router();

router.post('/gumroad',
    webhookLimiter,
    express.urlencoded({ extended: true }),
    asyncHandler(gumroadWebhook)
);

module.exports = router;
