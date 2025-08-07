require('dotenv').config();
const express = require('express');
const { connectToDatabase } = require('./config/database');
const { setupMiddleware } = require('./middleware');
const routes = require('./routes');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');

const app = express();

// Setup middleware and get rate limiters
const rateLimiters = setupMiddleware(app);

// Health check (before database connection and rate limiting)
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'development'
    });
});

// Database connection middleware (optimized for serverless)
app.use(async (req, res, next) => {
    try {
        await connectToDatabase();
        next();
    } catch (err) {
        console.error('Database connection failed:', err);
        res.status(503).json({
            error: 'Database service temporarily unavailable',
            retryAfter: 30,
            details: process.env.NODE_ENV === 'development' ? err.message : undefined
        });
    }
});

// Routes with rate limiting
app.use('/api', rateLimiters.apiLimiter, routes);

// Error handling
app.use(errorHandler);
app.use(notFoundHandler);

// Graceful shutdown (not needed for Vercel but good for local development)
if (process.env.NODE_ENV !== 'production') {
    process.on('SIGTERM', async () => {
        console.log('SIGTERM received, shutting down gracefully');
        const { closeConnection } = require('./config/database');
        await closeConnection();
        process.exit(0);
    });

    process.on('SIGINT', async () => {
        console.log('SIGINT received, shutting down gracefully');
        const { closeConnection } = require('./config/database');
        await closeConnection();
        process.exit(0);
    });
}

// Export for Vercel
module.exports = app;

// Start server only if not in Vercel environment
if (process.env.NODE_ENV !== 'production' || !process.env.VERCEL) {
    const PORT = process.env.PORT || 5000;
    app.listen(PORT, () => {
        console.log(`DocsGen backend running on port ${PORT}`);
        console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
    });
}
