const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { query } = require('../config/database');

router.get('/', authenticate, async (req, res, next) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;

    const [result, countResult] = await Promise.all([
      query(
        `SELECT n.*, u.username as actor_username, u.display_name as actor_name, u.avatar_url as actor_avatar
         FROM notifications n
         LEFT JOIN users u ON n.actor_id = u.user_id
         WHERE n.recipient_id = $1
         ORDER BY n.created_at DESC LIMIT $2 OFFSET $3`,
        [req.user.user_id, limit, offset]
      ),
      query(
        'SELECT COUNT(*) FROM notifications WHERE recipient_id = $1 AND is_read = false',
        [req.user.user_id]
      ),
    ]);

    res.json({
      notifications: result.rows,
      unread_count: parseInt(countResult.rows[0].count),
    });
  } catch (err) { next(err); }
});

router.put('/read-all', authenticate, async (req, res, next) => {
  try {
    await query('UPDATE notifications SET is_read = true WHERE recipient_id = $1', [req.user.user_id]);
    res.json({ message: 'All marked as read' });
  } catch (err) { next(err); }
});

router.put('/:id/read', authenticate, async (req, res, next) => {
  try {
    await query(
      'UPDATE notifications SET is_read = true WHERE notification_id = $1 AND recipient_id = $2',
      [req.params.id, req.user.user_id]
    );
    res.json({ message: 'Marked as read' });
  } catch (err) { next(err); }
});

module.exports = router;
