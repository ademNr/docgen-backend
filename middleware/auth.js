const User = require('../models/User');
const { createHash, timingSafeEqual } = require('crypto');

const authenticateToken = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;

        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({
                error: 'Unauthorized - Bearer token required'
            });
        }

        const token = authHeader.split(' ')[1];

        if (!token || token.length < 10) {
            return res.status(401).json({
                error: 'Invalid token format'
            });
        }

        req.token = token;
        next();
    } catch (error) {
        console.error('Token authentication error:', error);
        res.status(500).json({ error: 'Authentication service error' });
    }
};

const authenticateUser = async (req, res, next) => {
    try {
        const { userId } = req.body;

        if (!userId) {
            return res.status(400).json({ error: 'User ID is required' });
        }

        const user = await User.findOne({ githubId: userId }).select('+accessToken');

        if (!user) {
            return res.status(401).json({ error: 'User not found' });
        }

        // Verify token matches
        const userTokenHash = createHash('sha256').update(user.accessToken).digest();
        const requestTokenHash = createHash('sha256').update(req.token).digest();

        if (!timingSafeEqual(userTokenHash, requestTokenHash)) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }

        req.user = user;
        next();
    } catch (error) {
        console.error('User authentication error:', error);
        res.status(500).json({ error: 'Authentication failed' });
    }
};

const requireAdmin = (req, res, next) => {
    try {
        const { adminKey } = req.body;

        if (!adminKey || !process.env.ADMIN_KEY) {
            return res.status(403).json({ error: 'Unauthorized' });
        }

        const adminKeyHash = createHash('sha256').update(process.env.ADMIN_KEY).digest();
        const providedKeyHash = createHash('sha256').update(adminKey).digest();

        if (!timingSafeEqual(adminKeyHash, providedKeyHash)) {
            return res.status(403).json({ error: 'Unauthorized' });
        }

        next();
    } catch (error) {
        console.error('Admin authentication error:', error);
        res.status(500).json({ error: 'Authentication failed' });
    }
};

module.exports = {
    authenticateToken,
    authenticateUser,
    requireAdmin
};
