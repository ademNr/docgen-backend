const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const hpp = require('hpp');
const compression = require('compression');
const { customSanitizeMiddleware } = require('./customSanitize');

const createRateLimiter = (windowMs, max, message) => {
    return rateLimit({
        windowMs,
        max,
        message: { error: message },
        standardHeaders: true,
        legacyHeaders: false,
        handler: (req, res) => {
            res.status(429).json({
                error: message,
                retryAfter: Math.round(windowMs / 1000)
            });
        }
    });
};

const authLimiter = createRateLimiter(
    15 * 60 * 1000, // 15 minutes
    5, // 5 attempts
    'Too many authentication attempts, please try again later'
);

const apiLimiter = createRateLimiter(
    15 * 60 * 1000, // 15 minutes
    100, // 100 requests
    'Too many API requests, please try again later'
);

const docsLimiter = createRateLimiter(
    60 * 60 * 1000, // 1 hour
    20, // 20 documentation generations
    'Too many documentation generation requests, please try again later'
);

const webhookLimiter = createRateLimiter(
    5 * 60 * 1000, // 5 minutes
    50, // 50 webhook calls
    'Too many webhook requests'
);

const setupSecurity = (app) => {
    app.set('trust proxy', 1);

    app.use(helmet({
        contentSecurityPolicy: {
            directives: {
                defaultSrc: ["'self'"],
                styleSrc: ["'self'", "'unsafe-inline'"],
                scriptSrc: ["'self'"],
                imgSrc: ["'self'", "data:", "https:"],
                connectSrc: ["'self'", "https://api.github.com", "https://generativelanguage.googleapis.com"],
                fontSrc: ["'self'"],
                objectSrc: ["'none'"],
                mediaSrc: ["'self'"],
                frameSrc: ["'none'"],
            },
        },
        crossOriginEmbedderPolicy: false
    }));

    app.use(compression());
    app.use(customSanitizeMiddleware);
    app.use(hpp({
        whitelist: ['sort', 'fields', 'page', 'limit']
    }));

    return {
        authLimiter,
        apiLimiter,
        docsLimiter,
        webhookLimiter
    };
};

module.exports = {
    setupSecurity,
    authLimiter,
    apiLimiter,
    docsLimiter,
    webhookLimiter
};
