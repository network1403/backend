const { query } = require('../config/database');
const { cache } = require('../config/redis');
const bcrypt = require('bcryptjs');

const getProfile = async (req, res, next) => {
  try {
    const { username } = req.params;
    const viewerId = req.user?.user_id;

    const cacheKey = `user:profile:${username}`;
    let user = await cache.get(cacheKey);

    if (!user) {
      const result = await query(
        `SELECT user_id, username, display_name, bio, avatar_url, cover_url,
                is_verified, role, followers_count, following_count,
                total_questions, total_correct, total_answers, created_at
         FROM users WHERE username = $1 AND is_active = true`,
        [username]
      );
      if (!result.rows[0]) return res.status(404).json({ error: 'User not found' });
      user = result.rows[0];
      await cache.set(cacheKey, user, 300);
    }

    let isFollowing = false;
    if (viewerId && viewerId !== user.user_id) {
      const f = await query(
        'SELECT 1 FROM follows WHERE follower_id = $1 AND following_id = $2',
        [viewerId, user.user_id]
      );
      isFollowing = f.rows.length > 0;
    }

    const accuracy = user.total_answers > 0
      ? Math.round((user.total_correct / user.total_answers) * 100)
      : 0;

    res.json({ ...user, is_following: isFollowing, accuracy });
  } catch (err) { next(err); }
};

const getUserQuestions = async (req, res, next) => {
  try {
    const { username } = req.params;
    const { page = 1, limit = 15 } = req.query;
    const offset = (page - 1) * limit;

    const userResult = await query('SELECT user_id FROM users WHERE username = $1 AND is_active = true', [username]);
    if (!userResult.rows[0]) return res.status(404).json({ error: 'User not found' });
    const userId = userResult.rows[0].user_id;

    const result = await query(
      `SELECT q.*, c.name_ar as category_name, c.icon_emoji as category_icon
       FROM questions q
       LEFT JOIN categories c ON q.category_id = c.category_id
       WHERE q.user_id = $1 AND q.status = 'published'
       ORDER BY q.is_pinned DESC, q.created_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    );

    const ids = result.rows.map(q => q.question_id);
    let optMap = {};
    if (ids.length) {
      const opts = await query(
        'SELECT option_id, question_id, option_label, option_text, display_order FROM question_options WHERE question_id = ANY($1) ORDER BY display_order',
        [ids]
      );
      optMap = opts.rows.reduce((acc, o) => {
        if (!acc[o.question_id]) acc[o.question_id] = [];
        acc[o.question_id].push(o);
        return acc;
      }, {});
    }

    const questions = result.rows.map(q => ({ ...q, options: optMap[q.question_id] || [] }));
    res.json({ questions, page: parseInt(page), limit: parseInt(limit) });
  } catch (err) { next(err); }
};

const getUserStats = async (req, res, next) => {
  try {
    const { username } = req.params;
    const userResult = await query('SELECT user_id FROM users WHERE username = $1', [username]);
    if (!userResult.rows[0]) return res.status(404).json({ error: 'User not found' });
    const userId = userResult.rows[0].user_id;

    const [user, categoryStats, recentActivity] = await Promise.all([
      query('SELECT total_questions, total_answers, total_correct FROM users WHERE user_id = $1', [userId]),
      query(
        `SELECT c.name_ar, c.icon_emoji, COUNT(q.question_id) as count
         FROM questions q JOIN categories c ON q.category_id = c.category_id
         WHERE q.user_id = $1 AND q.status = 'published'
         GROUP BY c.category_id, c.name_ar, c.icon_emoji ORDER BY count DESC LIMIT 5`,
        [userId]
      ),
      query(
        `SELECT DATE(created_at) as date, COUNT(*) as questions
         FROM questions WHERE user_id = $1 AND created_at > NOW() - INTERVAL '30 days'
         GROUP BY DATE(created_at) ORDER BY date`,
        [userId]
      ),
    ]);

    const stats = user.rows[0];
    const accuracy = stats.total_answers > 0
      ? Math.round((stats.total_correct / stats.total_answers) * 100) : 0;

    res.json({ ...stats, accuracy, category_stats: categoryStats.rows, recent_activity: recentActivity.rows });
  } catch (err) { next(err); }
};

const updateProfile = async (req, res, next) => {
  try {
    const { display_name, bio } = req.body;
    const userId = req.user.user_id;

    const updates = [];
    const values = [];
    let i = 1;

    if (display_name !== undefined) { updates.push(`display_name = $${i++}`); values.push(display_name); }
    if (bio !== undefined) { updates.push(`bio = $${i++}`); values.push(bio); }
    if (req.file) { updates.push(`avatar_url = $${i++}`); values.push(`/uploads/${req.file.filename}`); }

    if (!updates.length) return res.status(400).json({ error: 'Nothing to update' });

    values.push(userId);
    const result = await query(
      `UPDATE users SET ${updates.join(', ')}, updated_at = NOW() WHERE user_id = $${i}
       RETURNING user_id, username, display_name, bio, avatar_url, cover_url`,
      values
    );

    await cache.del(`user:profile:${req.user.username}`);
    res.json(result.rows[0]);
  } catch (err) { next(err); }
};

const followUser = async (req, res, next) => {
  try {
    const { id } = req.params;
    const followerId = req.user.user_id;

    if (id === followerId) return res.status(400).json({ error: 'Cannot follow yourself' });

    const existing = await query('SELECT 1 FROM follows WHERE follower_id = $1 AND following_id = $2', [followerId, id]);
    if (existing.rows.length > 0) {
      await query('DELETE FROM follows WHERE follower_id = $1 AND following_id = $2', [followerId, id]);
      await query('UPDATE users SET followers_count = GREATEST(0, followers_count - 1) WHERE user_id = $1', [id]);
      await query('UPDATE users SET following_count = GREATEST(0, following_count - 1) WHERE user_id = $1', [followerId]);
      await cache.delPattern('user:profile:*');
      return res.json({ following: false });
    }

    await query('INSERT INTO follows (follower_id, following_id) VALUES ($1, $2)', [followerId, id]);
    await query('UPDATE users SET followers_count = followers_count + 1 WHERE user_id = $1', [id]);
    await query('UPDATE users SET following_count = following_count + 1 WHERE user_id = $1', [followerId]);
    await cache.delPattern('user:profile:*');
    res.json({ following: true });
  } catch (err) { next(err); }
};

const getFollowers = async (req, res, next) => {
  try {
    const { username } = req.params;
    const { page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;
    const userResult = await query('SELECT user_id FROM users WHERE username = $1', [username]);
    if (!userResult.rows[0]) return res.status(404).json({ error: 'User not found' });
    const result = await query(
      `SELECT u.user_id, u.username, u.display_name, u.avatar_url, u.is_verified, u.bio
       FROM follows f JOIN users u ON f.follower_id = u.user_id
       WHERE f.following_id = $1 ORDER BY f.created_at DESC LIMIT $2 OFFSET $3`,
      [userResult.rows[0].user_id, limit, offset]
    );
    res.json({ users: result.rows });
  } catch (err) { next(err); }
};

const getFollowing = async (req, res, next) => {
  try {
    const { username } = req.params;
    const { page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;
    const userResult = await query('SELECT user_id FROM users WHERE username = $1', [username]);
    if (!userResult.rows[0]) return res.status(404).json({ error: 'User not found' });
    const result = await query(
      `SELECT u.user_id, u.username, u.display_name, u.avatar_url, u.is_verified, u.bio
       FROM follows f JOIN users u ON f.following_id = u.user_id
       WHERE f.follower_id = $1 ORDER BY f.created_at DESC LIMIT $2 OFFSET $3`,
      [userResult.rows[0].user_id, limit, offset]
    );
    res.json({ users: result.rows });
  } catch (err) { next(err); }
};

// Bookmarks for current user
const getMyBookmarks = async (req, res, next) => {
  try {
    const { page = 1, limit = 15 } = req.query;
    const offset = (page - 1) * limit;
    const userId = req.user.user_id;

    const result = await query(
      `SELECT q.*, u.username, u.display_name, u.avatar_url, u.is_verified,
              c.name_ar as category_name, c.icon_emoji as category_icon
       FROM bookmarks b
       JOIN questions q ON b.question_id = q.question_id
       JOIN users u ON q.user_id = u.user_id
       LEFT JOIN categories c ON q.category_id = c.category_id
       WHERE b.user_id = $1 AND q.status = 'published'
       ORDER BY b.created_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    );

    const ids = result.rows.map(q => q.question_id);
    let optMap = {};
    if (ids.length) {
      const opts = await query(
        'SELECT option_id, question_id, option_label, option_text, display_order FROM question_options WHERE question_id = ANY($1) ORDER BY display_order',
        [ids]
      );
      optMap = opts.rows.reduce((acc, o) => {
        if (!acc[o.question_id]) acc[o.question_id] = [];
        acc[o.question_id].push(o);
        return acc;
      }, {});
    }

    const questions = result.rows.map(q => ({
      ...q,
      options: optMap[q.question_id] || [],
      interactions: { bookmarked: true, liked: false, retweeted: false },
    }));

    res.json({ questions, page: parseInt(page), limit: parseInt(limit) });
  } catch (err) { next(err); }
};

module.exports = {
  getProfile, getUserQuestions, getUserStats, updateProfile,
  followUser, getFollowers, getFollowing, getMyBookmarks,
};
