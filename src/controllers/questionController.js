const { query, getClient } = require('../config/database');
const { cache } = require('../config/redis');

async function createNotification(recipientId, actorId, type, entityType, entityId) {
  const messages = {
    new_follower: 'بدأ متابعتك',
    question_answered: 'أجاب على سؤالك',
    question_retweeted: 'أعاد تغريد سؤالك',
    comment_on_question: 'علّق على سؤالك',
    comment_reply: 'ردّ على تعليقك',
    question_liked: 'أعجب بسؤالك',
  };
  try {
    await query(
      `INSERT INTO notifications (recipient_id, actor_id, type, entity_type, entity_id, message)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [recipientId, actorId, type, entityType, entityId, messages[type] || 'تفاعل جديد']
    );
  } catch { /* silent */ }
}

// ─── GET QUESTION ───────────────────────────────────────────
const getQuestion = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user?.user_id;

    const cacheKey = `question:${id}`;
    let question = await cache.get(cacheKey);

    if (!question) {
      const result = await query(
        `SELECT q.*,
                u.username, u.display_name, u.avatar_url, u.is_verified,
                c.name_ar as category_name, c.icon_emoji as category_icon
         FROM questions q
         JOIN users u ON q.user_id = u.user_id
         LEFT JOIN categories c ON q.category_id = c.category_id
         WHERE q.question_id = $1 AND q.status = 'published'`,
        [id]
      );
      if (!result.rows[0]) return res.status(404).json({ error: 'Question not found' });

      const optResult = await query(
        'SELECT option_id, option_label, option_text, display_order, selection_count FROM question_options WHERE question_id = $1 ORDER BY display_order',
        [id]
      );

      question = { ...result.rows[0], options: optResult.rows };
      await cache.set(cacheKey, question, 600);
      query('UPDATE questions SET view_count = view_count + 1 WHERE question_id = $1', [id]).catch(() => {});
    }

    let userAnswer = null;
    let interactions = { liked: false, bookmarked: false, retweeted: false };

    if (userId) {
      const [answerResult, likes, bookmarks, retweets] = await Promise.all([
        query(
          `SELECT ua.*, qo.option_label, qo.option_text
           FROM user_answers ua
           JOIN question_options qo ON ua.selected_option_id = qo.option_id
           WHERE ua.user_id = $1 AND ua.question_id = $2`,
          [userId, id]
        ),
        query('SELECT 1 FROM likes WHERE user_id = $1 AND question_id = $2', [userId, id]),
        query('SELECT 1 FROM bookmarks WHERE user_id = $1 AND question_id = $2', [userId, id]),
        query('SELECT 1 FROM retweets WHERE user_id = $1 AND question_id = $2', [userId, id]),
      ]);

      userAnswer = answerResult.rows[0] || null;
      interactions = {
        liked: likes.rows.length > 0,
        bookmarked: bookmarks.rows.length > 0,
        retweeted: retweets.rows.length > 0,
      };
    }

    let correctOption = null;
    let explanation = null;
    if (userAnswer) {
      const [correctOpt, expl] = await Promise.all([
        query('SELECT option_id, option_label, option_text FROM question_options WHERE question_id = $1 AND is_correct = true', [id]),
        query(
          `SELECT qe.*, qo.option_label as correct_label, qo.option_text as correct_text
           FROM question_explanations qe
           JOIN question_options qo ON qe.correct_option_id = qo.option_id
           WHERE qe.question_id = $1`,
          [id]
        ),
      ]);
      correctOption = correctOpt.rows[0];
      explanation = expl.rows[0] || null;
    }

    res.json({ ...question, user_answer: userAnswer, interactions, correct_option: correctOption, explanation });
  } catch (err) { next(err); }
};

// ─── CREATE QUESTION ────────────────────────────────────────
const createQuestion = async (req, res, next) => {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    const { content, category_id, difficulty, difficulty_label, options, explanation_text, explanation_source, media_url, ai_generated } = req.body;

    if (!content?.trim()) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Question content is required' });
    }
    if (!options || options.length < 2 || options.length > 4) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Question must have 2-4 options' });
    }
    if (options.filter(o => o.is_correct).length !== 1) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Exactly one option must be marked correct' });
    }
    if (!explanation_text?.trim() || explanation_text.trim().length < 20) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Explanation must be at least 20 characters' });
    }

    const labels = ['أ', 'ب', 'ج', 'د'];

    const qResult = await client.query(
      `INSERT INTO questions (user_id, content, category_id, difficulty, difficulty_label, ai_generated, ai_model_version)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [req.user.user_id, content.trim(), category_id || null, difficulty || 5,
       difficulty_label || 'medium', ai_generated || false,
       ai_generated ? (process.env.OPENAI_MODEL || 'gpt-4o-mini') : null]
    );
    const question = qResult.rows[0];

    let correctOptionId;
    for (let i = 0; i < options.length; i++) {
      const opt = options[i];
      const optResult = await client.query(
        `INSERT INTO question_options (question_id, option_label, option_text, is_correct, display_order)
         VALUES ($1, $2, $3, $4, $5) RETURNING option_id`,
        [question.question_id, labels[i], opt.option_text.trim(), opt.is_correct, i + 1]
      );
      if (opt.is_correct) correctOptionId = optResult.rows[0].option_id;
    }

    await client.query(
      `INSERT INTO question_explanations (question_id, correct_option_id, explanation_text, explanation_source, media_url, is_ai_generated)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [question.question_id, correctOptionId, explanation_text.trim(), explanation_source || null, media_url || null, ai_generated || false]
    );

    await client.query('UPDATE users SET total_questions = total_questions + 1 WHERE user_id = $1', [req.user.user_id]);
    if (category_id) {
      await client.query('UPDATE categories SET question_count = question_count + 1 WHERE category_id = $1', [category_id]);
    }

    await client.query('COMMIT');
    await cache.delPattern('feed:*');

    res.status(201).json({ ...question, message: 'Question created successfully' });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
};

// ─── ANSWER QUESTION ────────────────────────────────────────
const answerQuestion = async (req, res, next) => {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    const { id } = req.params;
    const { option_id, time_taken_ms } = req.body;
    const userId = req.user.user_id;

    const existing = await client.query(
      'SELECT answer_id FROM user_answers WHERE user_id = $1 AND question_id = $2',
      [userId, id]
    );
    if (existing.rows.length > 0) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Already answered this question' });
    }

    const optResult = await client.query(
      'SELECT option_id, is_correct, option_label, option_text FROM question_options WHERE option_id = $1 AND question_id = $2',
      [option_id, id]
    );
    if (!optResult.rows[0]) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Invalid option for this question' });
    }

    const option = optResult.rows[0];
    const isCorrect = option.is_correct;

    await client.query(
      `INSERT INTO user_answers (user_id, question_id, selected_option_id, is_correct, time_taken_ms)
       VALUES ($1, $2, $3, $4, $5)`,
      [userId, id, option_id, isCorrect, time_taken_ms || null]
    );

    const countField = isCorrect ? 'correct_count' : 'wrong_count';
    await client.query(
      `UPDATE questions SET answer_count = answer_count + 1, ${countField} = ${countField} + 1 WHERE question_id = $1`,
      [id]
    );
    await client.query('UPDATE question_options SET selection_count = selection_count + 1 WHERE option_id = $1', [option_id]);
    await client.query(
      `UPDATE users SET total_answers = total_answers + 1${isCorrect ? ', total_correct = total_correct + 1' : ''} WHERE user_id = $1`,
      [userId]
    );

    const [expl, correctOpt, statsResult, distribution] = await Promise.all([
      client.query(
        `SELECT qe.*, qo.option_label as correct_label, qo.option_text as correct_text
         FROM question_explanations qe
         JOIN question_options qo ON qe.correct_option_id = qo.option_id
         WHERE qe.question_id = $1`,
        [id]
      ),
      client.query('SELECT option_id, option_label, option_text FROM question_options WHERE question_id = $1 AND is_correct = true', [id]),
      client.query('SELECT answer_count, correct_count, wrong_count FROM questions WHERE question_id = $1', [id]),
      client.query('SELECT option_id, option_label, option_text, selection_count FROM question_options WHERE question_id = $1 ORDER BY display_order', [id]),
    ]);

    await client.query('COMMIT');
    await cache.del(`question:${id}`);

    // Notify owner async
    query('SELECT user_id FROM questions WHERE question_id = $1', [id]).then(r => {
      if (r.rows[0] && r.rows[0].user_id !== userId) {
        createNotification(r.rows[0].user_id, userId, 'question_answered', 'question', id);
      }
    }).catch(() => {});

    res.json({
      is_correct: isCorrect,
      selected_option: option,
      correct_option: correctOpt.rows[0],
      explanation: expl.rows[0] || null,
      stats: statsResult.rows[0],
      distribution: distribution.rows,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    next(err);
  } finally {
    client.release();
  }
};

// ─── TOGGLE LIKE ────────────────────────────────────────────
const toggleLike = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user.user_id;

    const existing = await query('SELECT 1 FROM likes WHERE user_id = $1 AND question_id = $2', [userId, id]);
    if (existing.rows.length > 0) {
      await query('DELETE FROM likes WHERE user_id = $1 AND question_id = $2', [userId, id]);
      await query('UPDATE questions SET like_count = GREATEST(0, like_count - 1) WHERE question_id = $1', [id]);
      return res.json({ liked: false });
    }
    await query('INSERT INTO likes (user_id, question_id) VALUES ($1, $2)', [userId, id]);
    await query('UPDATE questions SET like_count = like_count + 1 WHERE question_id = $1', [id]);
    await cache.del(`question:${id}`);

    query('SELECT user_id FROM questions WHERE question_id = $1', [id]).then(r => {
      if (r.rows[0] && r.rows[0].user_id !== userId) {
        createNotification(r.rows[0].user_id, userId, 'question_liked', 'question', id);
      }
    }).catch(() => {});

    res.json({ liked: true });
  } catch (err) { next(err); }
};

// ─── TOGGLE BOOKMARK ────────────────────────────────────────
const toggleBookmark = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user.user_id;

    const existing = await query('SELECT 1 FROM bookmarks WHERE user_id = $1 AND question_id = $2', [userId, id]);
    if (existing.rows.length > 0) {
      await query('DELETE FROM bookmarks WHERE user_id = $1 AND question_id = $2', [userId, id]);
      await query('UPDATE questions SET bookmark_count = GREATEST(0, bookmark_count - 1) WHERE question_id = $1', [id]);
      return res.json({ bookmarked: false });
    }
    await query('INSERT INTO bookmarks (user_id, question_id) VALUES ($1, $2)', [userId, id]);
    await query('UPDATE questions SET bookmark_count = bookmark_count + 1 WHERE question_id = $1', [id]);
    res.json({ bookmarked: true });
  } catch (err) { next(err); }
};

// ─── TOGGLE RETWEET ─────────────────────────────────────────
const toggleRetweet = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user.user_id;
    const { comment } = req.body;

    const existing = await query('SELECT 1 FROM retweets WHERE user_id = $1 AND question_id = $2', [userId, id]);
    if (existing.rows.length > 0) {
      await query('DELETE FROM retweets WHERE user_id = $1 AND question_id = $2', [userId, id]);
      await query('UPDATE questions SET retweet_count = GREATEST(0, retweet_count - 1) WHERE question_id = $1', [id]);
      return res.json({ retweeted: false });
    }
    await query('INSERT INTO retweets (user_id, question_id, comment) VALUES ($1, $2, $3)', [userId, id, comment || null]);
    await query('UPDATE questions SET retweet_count = retweet_count + 1 WHERE question_id = $1', [id]);
    res.json({ retweeted: true });
  } catch (err) { next(err); }
};

// ─── DELETE QUESTION ────────────────────────────────────────
const deleteQuestion = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user.user_id;

    const q = await query('SELECT user_id, category_id FROM questions WHERE question_id = $1', [id]);
    if (!q.rows[0]) return res.status(404).json({ error: 'Question not found' });

    const isOwner = q.rows[0].user_id === userId;
    const isAdmin = ['admin', 'superadmin'].includes(req.user.role);
    if (!isOwner && !isAdmin) return res.status(403).json({ error: 'Not authorized' });

    await query('DELETE FROM questions WHERE question_id = $1', [id]);
    await query('UPDATE users SET total_questions = GREATEST(0, total_questions - 1) WHERE user_id = $1', [q.rows[0].user_id]);
    if (q.rows[0].category_id) {
      await query('UPDATE categories SET question_count = GREATEST(0, question_count - 1) WHERE category_id = $1', [q.rows[0].category_id]);
    }

    await cache.del(`question:${id}`);
    await cache.delPattern('feed:*');
    res.json({ message: 'Question deleted' });
  } catch (err) { next(err); }
};

// ─── COMMENTS ───────────────────────────────────────────────
const getComments = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;

    const result = await query(
      `SELECT c.*, u.username, u.display_name, u.avatar_url, u.is_verified
       FROM comments c
       JOIN users u ON c.user_id = u.user_id
       WHERE c.question_id = $1 AND c.parent_id IS NULL AND c.is_deleted = false
       ORDER BY c.created_at DESC
       LIMIT $2 OFFSET $3`,
      [id, limit, offset]
    );

    res.json({ comments: result.rows, page: parseInt(page), limit: parseInt(limit) });
  } catch (err) { next(err); }
};

const addComment = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { content, parent_id } = req.body;

    if (!content?.trim()) return res.status(400).json({ error: 'Comment content required' });

    const result = await query(
      `INSERT INTO comments (question_id, user_id, content, parent_id)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [id, req.user.user_id, content.trim(), parent_id || null]
    );

    const comment = result.rows[0];
    query('SELECT user_id FROM questions WHERE question_id = $1', [id]).then(r => {
      if (r.rows[0] && r.rows[0].user_id !== req.user.user_id) {
        createNotification(r.rows[0].user_id, req.user.user_id, 'comment_on_question', 'question', id);
      }
    }).catch(() => {});

    res.status(201).json({ ...comment, username: req.user.username, display_name: req.user.display_name, avatar_url: req.user.avatar_url });
  } catch (err) { next(err); }
};

// ─── AI GENERATE ────────────────────────────────────────────
const aiGenerate = async (req, res, next) => {
  try {
    const { topic, category_id, difficulty_label } = req.body;
    if (!process.env.OPENAI_API_KEY) {
      return res.status(503).json({ error: 'AI generation not configured. Set OPENAI_API_KEY in .env' });
    }

    const prompt = `قم بإنشاء سؤال اختيار من متعدد باللغة العربية حول: "${topic}"
المستوى: ${difficulty_label || 'متوسط'}
يجب أن يحتوي على 4 خيارات (أ، ب، ج، د) مع تحديد الصحيح، وشرح مفصل لا يقل عن 20 حرف.
أجب بتنسيق JSON فقط:
{
  "content": "نص السؤال",
  "options": [
    {"option_text": "الخيار أ", "is_correct": false},
    {"option_text": "الخيار ب", "is_correct": true},
    {"option_text": "الخيار ج", "is_correct": false},
    {"option_text": "الخيار د", "is_correct": false}
  ],
  "explanation_text": "شرح مفصل للإجابة الصحيحة (20 حرف على الأقل)",
  "explanation_source": "المصدر إن وُجد"
}`;

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' },
        max_tokens: 800,
      }),
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || 'OpenAI error');

    const generated = JSON.parse(data.choices[0].message.content);
    res.json({ ...generated, ai_generated: true, category_id, difficulty_label });
  } catch (err) { next(err); }
};

module.exports = {
  getQuestion, createQuestion, answerQuestion,
  toggleLike, toggleBookmark, toggleRetweet,
  deleteQuestion, getComments, addComment, aiGenerate,
};
