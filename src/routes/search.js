const express = require('express');
const router = express.Router();
const { query } = require('../config/database');

router.get('/', async (req, res, next) => {
  try {
    const { q, type = 'questions', category_id, difficulty_label, page = 1, limit = 20 } = req.query;
    if (!q || q.trim().length < 2) return res.status(400).json({ error: 'Search query must be at least 2 characters' });

    const offset = (page - 1) * limit;
    const search = `%${q.trim()}%`;

    if (type === 'users') {
      const result = await query(
        `SELECT user_id, username, display_name, avatar_url, is_verified, bio, followers_count
         FROM users WHERE (username ILIKE $1 OR display_name ILIKE $1) AND is_active = true
         ORDER BY followers_count DESC LIMIT $2 OFFSET $3`,
        [search, limit, offset]
      );
      return res.json({ results: result.rows, type: 'users' });
    }

    // Questions search
    const params = [search];
    let whereClause = "q.status = 'published' AND q.content ILIKE $1";

    if (category_id) {
      params.push(category_id);
      whereClause += ` AND q.category_id = $${params.length}`;
    }
    if (difficulty_label) {
      params.push(difficulty_label);
      whereClause += ` AND q.difficulty_label = $${params.length}`;
    }

    params.push(limit, offset);
    const result = await query(
      `SELECT q.*, u.username, u.display_name, u.avatar_url, u.is_verified,
              c.name_ar as category_name, c.icon_emoji as category_icon
       FROM questions q
       JOIN users u ON q.user_id = u.user_id
       LEFT JOIN categories c ON q.category_id = c.category_id
       WHERE ${whereClause}
       ORDER BY q.answer_count DESC
       LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    res.json({ results: result.rows, type: 'questions' });
  } catch (err) { next(err); }
});

module.exports = router;
