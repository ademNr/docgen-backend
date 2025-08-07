const mongoose = require('mongoose');

const errorHandler = (error, req, res, next) => {
    console.error('Error details:', {
        message: error.message,
        stack: process.env.NODE_ENV === 'development' ? error.stack : undefined,
        url: req.url,
        method: req.method,
        ip: req.ip,
        userAgent: req.get('User-Agent')
    });

    // Mongoose validation error
    if (error.name === 'ValidationError') {
        const errors = Object.values(error.errors).map(err => ({
            field: err.path,
            message: err.message
        }));
        return res.status(400).json({
            error: 'Validation failed',
            details: errors
        });
    }

    // Mongoose cast error (invalid ObjectId)
    if (error.name === 'CastError') {
        return res.status(400).json({
            error: 'Invalid ID format',
            field: error.path
        });
    }

    // Mongoose duplicate key error
    if (error.code === 11000) {
        const field = Object.keys(error.keyValue)[0];
        return res.status(409).json({
            error: `${field} already exists`,
            field: field
        });
    }

    // JWT errors
    if (error.name === 'JsonWebTokenError') {
        return res.status(401).json({ error: 'Invalid token' });
    }

    if (error.name === 'TokenExpiredError') {
        return res.status(401).json({ error: 'Token expired' });
    }

    // Rate limit error
    if (error.status === 429) {
        return res.status(429).json({
            error: 'Too many requests',
            retryAfter: error.retryAfter
        });
    }

    // MongoDB connection errors
    if (error instanceof mongoose.Error) {
        return res.status(503).json({
            error: 'Database service temporarily unavailable'
        });
    }

    // Axios/HTTP errors
    if (error.response) {
        const status = error.response.status;
        if (status === 401) {
            return res.status(401).json({ error: 'External service authentication failed' });
        }
        if (status === 403) {
            return res.status(403).json({ error: 'External service access forbidden' });
        }
        if (status === 404) {
            return res.status(404).json({ error: 'External resource not found' });
        }
        if (status >= 500) {
            return res.status(502).json({ error: 'External service error' });
        }
    }

    // Default error
    const statusCode = error.statusCode || error.status || 500;
    const message = process.env.NODE_ENV === 'production'
        ? 'Internal server error'
        : error.message;

    res.status(statusCode).json({
        error: message,
        ...(process.env.NODE_ENV === 'development' && { stack: error.stack })
    });
};

const notFoundHandler = (req, res) => {
    res.status(404).json({
        error: 'Endpoint not found',
        path: req.path,
        method: req.method
    });
};

// Async error wrapper
const asyncHandler = (fn) => (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
};

module.exports = {
    errorHandler,
    notFoundHandler,
    asyncHandler
};
