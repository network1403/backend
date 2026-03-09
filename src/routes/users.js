const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const {
  getProfile, getUserQuestions, getUserStats,
  updateProfile, followUser, getFollowers, getFollowing, getMyBookmarks,
} = require('../controllers/userController');
const { authenticate, optionalAuth } = require('../middleware/auth');

const uploadDir = path.join(__dirname, '../../uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    cb(null, `avatar-${req.user.user_id}-${Date.now()}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Images only'));
  },
});

// IMPORTANT: /me routes must come before /:username param routes
router.get('/me/bookmarks', authenticate, getMyBookmarks);
router.put('/me/profile', authenticate, upload.single('avatar'), updateProfile);

router.get('/:username', optionalAuth, getProfile);
router.get('/:username/questions', getUserQuestions);
router.get('/:username/stats', getUserStats);
router.get('/:username/followers', getFollowers);
router.get('/:username/following', getFollowing);
router.post('/:id/follow', authenticate, followUser);

module.exports = router;
