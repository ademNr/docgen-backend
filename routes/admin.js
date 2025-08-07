const express = require('express');
const { addCredits } = require('../controllers/adminController');
const { requireAdmin } = require('../middleware/auth');

const router = express.Router();

router.post('/add-credits', requireAdmin, addCredits);

module.exports = router;
