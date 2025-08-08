const express = require('express');
const cors = require('cors');
const { setupSecurity } = require('./security');

const setupMiddleware = (app) => {
    // Trust proxy for Vercel
    app.set('trust proxy', 1);

    // CORS configuration
    const corsOptions = {
        origin: process.env.NODE_ENV === 'production'
            ? [
                'https://gitforje.vercel.app',
                'https://www.gitforje.com'
            ]
            : ['http://localhost:3000', 'http://localhost:3001'],
        credentials: true,
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
        maxAge: 86400 // 24 hours
    };

    app.use(cors(corsOptions));

    // Security middleware
    const rateLimiters = setupSecurity(app);

    // Body parser middleware with size limits
    app.use(express.json({
        limit: '10mb',
        verify: (req, res, buf) => {
            req.rawBody = buf;
        }
    }));

    app.use(express.urlencoded({
        extended: true,
        limit: '10mb'
    }));

    // Request logging in development
    if (process.env.NODE_ENV === 'development') {
        app.use((req, res, next) => {
            console.log(`${new Date().toISOString()} - ${req.method} ${req.path}`);
            next();
        });
    }

    return rateLimiters;
};

module.exports = {
    setupMiddleware
};
