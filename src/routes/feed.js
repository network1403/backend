const express = require('express');
const router = express.Router();
const { getFollowingFeed, getForYouFeed, getTrending } = require('../controllers/feedController');
const { authenticate, optionalAuth } = require('../middleware/auth');

router.get('/following', authenticate, getFollowingFeed);
router.get('/for-you', optionalAuth, getForYouFeed);
router.get('/trending', optionalAuth, getTrending);

module.exports = router;
