const { body, query, param, validationResult } = require('express-validator');

const handleValidationErrors = (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({
            error: 'Validation failed',
            details: errors.array().map(err => ({
                field: err.path,
                message: err.msg,
                value: err.value
            }))
        });
    }
    next();
};

// Validation rules
const validateGithubAuth = [
    body('code')
        .notEmpty()
        .withMessage('Authorization code is required')
        .isLength({ min: 1, max: 500 })
        .withMessage('Invalid authorization code format'),
    handleValidationErrors
];

const validateGenerateDocs = [
    body('userId')
        .isNumeric()
        .withMessage('User ID must be a number'),
    body('owner')
        .notEmpty()
        .withMessage('Repository owner is required')
        .isLength({ min: 1, max: 100 })
        .withMessage('Owner name too long')
        .matches(/^[a-zA-Z0-9\-_.]+$/)
        .withMessage('Invalid owner name format'),
    body('repo')
        .notEmpty()
        .withMessage('Repository name is required')
        .isLength({ min: 1, max: 100 })
        .withMessage('Repository name too long')
        .matches(/^[a-zA-Z0-9\-_.]+$/)
        .withMessage('Invalid repository name format'),
    body('includeTests')
        .optional()
        .isBoolean()
        .withMessage('includeTests must be a boolean'),
    handleValidationErrors
];

const validateUpdateEmail = [
    body('userId')
        .isNumeric()
        .withMessage('User ID must be a number'),
    body('email')
        .isEmail()
        .withMessage('Valid email is required')
        .normalizeEmail()
        .isLength({ max: 254 })
        .withMessage('Email too long'),
    handleValidationErrors
];

const validateAddCredits = [
    body('adminKey')
        .notEmpty()
        .withMessage('Admin key is required'),
    body('githubId')
        .isNumeric()
        .withMessage('GitHub ID must be a number'),
    body('amount')
        .isInt({ min: 1, max: 1000 })
        .withMessage('Amount must be between 1 and 1000'),
    handleValidationErrors
];

const validateProgressQuery = [
    query('owner')
        .notEmpty()
        .withMessage('Owner is required')
        .matches(/^[a-zA-Z0-9\-_.]+$/)
        .withMessage('Invalid owner format'),
    query('repo')
        .notEmpty()
        .withMessage('Repository is required')
        .matches(/^[a-zA-Z0-9\-_.]+$/)
        .withMessage('Invalid repository format'),
    query('token')
        .notEmpty()
        .withMessage('Token is required')
        .isLength({ min: 10 })
        .withMessage('Invalid token format'),
    handleValidationErrors
];

module.exports = {
    validateGithubAuth,
    validateGenerateDocs,
    validateUpdateEmail,
    validateAddCredits,
    validateProgressQuery,
    handleValidationErrors
};
