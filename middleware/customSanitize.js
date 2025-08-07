// Enhanced custom sanitization middleware to replace both express-mongo-sanitize and xss-clean
const sanitizeInput = (obj) => {
    if (obj && typeof obj === 'object') {
        for (const key in obj) {
            if (obj.hasOwnProperty(key)) {
                // Remove keys that start with $ or contain .
                if (key.startsWith('$') || key.includes('.')) {
                    delete obj[key];
                } else if (typeof obj[key] === 'object') {
                    sanitizeInput(obj[key]);
                } else if (typeof obj[key] === 'string') {
                    // Enhanced XSS protection
                    obj[key] = sanitizeString(obj[key]);
                }
            }
        }
    }
    return obj;
};

const sanitizeString = (str) => {
    if (typeof str !== 'string') return str;

    return str
        // Remove script tags
        .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
        // Remove javascript: protocol
        .replace(/javascript:/gi, '')
        // Remove on* event handlers
        .replace(/on\w+\s*=/gi, '')
        // Remove potentially dangerous HTML tags
        .replace(/<(iframe|object|embed|link|meta|style)[^>]*>/gi, '')
        // Remove HTML comments
        .replace(/<!--[\s\S]*?-->/g, '')
        // Escape remaining HTML entities
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#x27;')
        .replace(/\//g, '&#x2F;');
};

const customSanitizeMiddleware = (req, res, next) => {
    try {
        // Create new sanitized objects instead of modifying existing ones
        if (req.body && typeof req.body === 'object') {
            req.body = sanitizeInput({ ...req.body });
        }

        // For query parameters, create a new object
        if (req.query && typeof req.query === 'object') {
            const sanitizedQuery = sanitizeInput({ ...req.query });
            // Replace the query object safely
            Object.keys(req.query).forEach(key => delete req.query[key]);
            Object.assign(req.query, sanitizedQuery);
        }

        // For URL parameters, create a new object
        if (req.params && typeof req.params === 'object') {
            const sanitizedParams = sanitizeInput({ ...req.params });
            Object.keys(req.params).forEach(key => delete req.params[key]);
            Object.assign(req.params, sanitizedParams);
        }

        next();
    } catch (error) {
        console.error('Sanitization error:', error);
        next(); // Continue even if sanitization fails
    }
};

module.exports = {
    customSanitizeMiddleware,
    sanitizeInput,
    sanitizeString
};
