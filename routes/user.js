const express = require('express');
const {
    getUserCredits,
    getUserRepos,
    updateUserEmail
} = require('../controllers/userController');
const { authenticateToken, authenticateUser } = require('../middleware/auth');
const { validateUpdateEmail } = require('../middleware/validation');
const { asyncHandler } = require('../middleware/errorHandler');

const router = express.Router();

router.post('/credits', authenticateToken, authenticateUser, asyncHandler(getUserCredits));
router.get('/repos', authenticateToken, asyncHandler(getUserRepos)); // Removed authenticateUser since it's not needed for repos
router.post('/update-email', validateUpdateEmail, asyncHandler(updateUserEmail));

module.exports = router;
