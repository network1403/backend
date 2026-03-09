const express = require('express');
const router = express.Router();
const {
  getQuestion, createQuestion, answerQuestion,
  toggleLike, toggleBookmark, toggleRetweet,
  deleteQuestion, getComments, addComment, aiGenerate,
} = require('../controllers/questionController');
const { authenticate, optionalAuth } = require('../middleware/auth');

// IMPORTANT: specific routes must come before :id param routes
router.post('/ai-generate', authenticate, aiGenerate);

router.get('/:id', optionalAuth, getQuestion);
router.post('/', authenticate, createQuestion);
router.delete('/:id', authenticate, deleteQuestion);
router.post('/:id/answer', authenticate, answerQuestion);
router.post('/:id/like', authenticate, toggleLike);
router.post('/:id/bookmark', authenticate, toggleBookmark);
router.post('/:id/retweet', authenticate, toggleRetweet);
router.get('/:id/comments', getComments);
router.post('/:id/comments', authenticate, addComment);

module.exports = router;
