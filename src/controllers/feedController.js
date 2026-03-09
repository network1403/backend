const { query } = require('../config/database');
const { cache } = require('../config/redis');

const BASE_QUERY = `
  SELECT q.*,
         u.username, u.display_name, u.avatar_url, u.is_verified,
         c.name_ar as category_name, c.icon_emoji as category_icon
  FROM questions q
  JOIN users u ON q.user_id = u.user_id
  LEFT JOIN categories c ON q.category_id = c.category_id
`;

const enrichQuestions = async (questions, userId) => {
  if (!questions.length) return [];
  const ids = questions.map(q => q.question_id);

  const optResult = await query(
    'SELECT option_id, question_id, option_label, option_text, display_order, selection_count FROM question_options WHERE question_id = ANY($1) ORDER BY display_order',
    [ids]
  );
  const optMap = optResult.rows.reduce((acc, opt) => {
    if (!acc[opt.question_id]) acc[opt.question_id] = [];
    acc[opt.question_id].push(opt);
    return acc;
  }, {});

  let answeredMap = {};
  if (userId) {
    const answered = await query(
      'SELECT question_id, selected_option_id, is_correct FROM user_answers WHERE user_id = $1 AND question_id = ANY($2)',
      [userId, ids]
    );
    answeredMap = answered.rows.reduce((acc, r) => {
      acc[r.question_id] = { selected_option_id: r.selected_option_id, is_correct: r.is_correct };
      return acc;
    }, {});
  }

  return questions.map(q => ({
    ...q,
    options: optMap[q.question_id] || [],
    user_answer: answeredMap[q.question_id] || null,
  }));
};

// Following feed
const getFollowingFeed = async (req, res, next) => {
  try {
    const { page = 1, limit = 15 } = req.query;
    const offset = (page - 1) * limit;
    const userId = req.user.user_id;

    const result = await query(
      `${BASE_QUERY}
       WHERE q.status = 'published'
         AND (q.user_id IN (SELECT following_id FROM follows WHERE follower_id = $1)
              OR q.user_id = $1)
       ORDER BY q.created_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    );

    const questions = await enrichQuestions(result.rows, userId);
    res.json({ questions, page: parseInt(page), limit: parseInt(limit) });
  } catch (err) { next(err); }
};

// For You feed
const getForYouFeed = async (req, res, next) => {
  try {
    const { page = 1, limit = 15, category_id } = req.query;
    const offset = (page - 1) * limit;
    const userId = req.user?.user_id;

    const cacheKey = `feed:foryou:${category_id || 'all'}:p${page}:u${userId || 'anon'}`;
    const cached = await cache.get(cacheKey);
    if (cached) return res.json(cached);

    const params = [limit, offset];
    let whereClause = "q.status = 'published'";
    if (category_id) {
      whereClause += ` AND q.category_id = $${params.length + 1}`;
      params.push(category_id);
    }

    const result = await query(
      `${BASE_QUERY}
       WHERE ${whereClause}
       ORDER BY (q.answer_count * 0.4 + q.like_count * 0.3 + q.retweet_count * 0.2 + q.view_count * 0.001)
                * EXP(-EXTRACT(EPOCH FROM (NOW() - q.created_at)) / 86400) DESC,
                q.created_at DESC
       LIMIT $1 OFFSET $2`,
      params
    );

    const questions = await enrichQuestions(result.rows, userId);
    const response = { questions, page: parseInt(page), limit: parseInt(limit) };
    await cache.set(cacheKey, response, 120);
    res.json(response);
  } catch (err) { next(err); }
};

// Trending feed
const getTrending = async (req, res, next) => {
  try {
    const { limit = 20 } = req.query;
    const userId = req.user?.user_id;

    const cached = await cache.get('feed:trending');
    if (cached) {
      const questions = await enrichQuestions(cached, userId);
      return res.json({ questions });
    }

    const result = await query(
      `${BASE_QUERY}
       WHERE q.status = 'published' AND q.created_at > NOW() - INTERVAL '7 days'
       ORDER BY q.answer_count DESC, q.like_count DESC
       LIMIT $1`,
      [limit]
    );

    await cache.set('feed:trending', result.rows, 1800);
    const questions = await enrichQuestions(result.rows, userId);
    res.json({ questions });
  } catch (err) { next(err); }
};

module.exports = { getFollowingFeed, getForYouFeed, getTrending };
