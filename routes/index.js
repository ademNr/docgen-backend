const express = require('express');
const authRoutes = require('./auth');
const userRoutes = require('./user');
const docsRoutes = require('./docs');
const adminRoutes = require('./admin');
const webhookRoutes = require('./webhook');
const healthRoutes = require('./health');

const router = express.Router();

router.use('/auth', authRoutes);
router.use('/user', userRoutes);
router.use('/docs', docsRoutes);
router.use('/admin', adminRoutes);
router.use('/webhook', webhookRoutes);
router.use('/health', healthRoutes);

// Test endpoint
router.get('/test', (req, res) => {
    res.json({ message: 'CORS test successful!' });
});

module.exports = router;
