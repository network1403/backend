const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { query } = require('../config/database');

const generateTokens = (userId) => {
  const accessToken = jwt.sign(
    { userId },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '15m' }
  );
  const refreshToken = jwt.sign(
    { userId, jti: uuidv4() },
    process.env.JWT_REFRESH_SECRET,
    { expiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '7d' }
  );
  return { accessToken, refreshToken };
};

const register = async (req, res, next) => {
  try {
    const { username, display_name, email, password } = req.body;

    if (!username || !display_name || !email || !password) {
      return res.status(400).json({ error: 'All fields are required' });
    }
    if (!/^[a-zA-Z0-9_]{3,50}$/.test(username)) {
      return res.status(400).json({ error: 'Username must be 3-50 chars: letters, numbers, underscore only' });
    }
    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    const existing = await query(
      'SELECT user_id FROM users WHERE email = $1 OR username = $2',
      [email.toLowerCase(), username.toLowerCase()]
    );
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: 'Email or username already taken' });
    }

    const password_hash = await bcrypt.hash(password, 12);
    const result = await query(
      `INSERT INTO users (username, display_name, email, password_hash)
       VALUES ($1, $2, $3, $4)
       RETURNING user_id, username, display_name, email, role, avatar_url, created_at`,
      [username.toLowerCase(), display_name, email.toLowerCase(), password_hash]
    );

    const user = result.rows[0];
    const { accessToken, refreshToken } = generateTokens(user.user_id);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await query(
      'INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)',
      [user.user_id, refreshToken, expiresAt]
    );

    res.status(201).json({ user, accessToken, refreshToken });
  } catch (err) { next(err); }
};

const login = async (req, res, next) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const result = await query(
      `SELECT user_id, username, display_name, email, password_hash, role,
              avatar_url, is_active, followers_count, following_count, total_questions
       FROM users WHERE email = $1`,
      [email.toLowerCase()]
    );

    const user = result.rows[0];
    if (!user || !user.is_active) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

    await query('UPDATE users SET last_login_at = NOW() WHERE user_id = $1', [user.user_id]);

    const { accessToken, refreshToken } = generateTokens(user.user_id);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await query(
      'INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)',
      [user.user_id, refreshToken, expiresAt]
    );

    const { password_hash, ...safeUser } = user;
    res.json({ user: safeUser, accessToken, refreshToken });
  } catch (err) { next(err); }
};

const refresh = async (req, res, next) => {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) return res.status(401).json({ error: 'Refresh token required' });

    let decoded;
    try {
      decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
    } catch {
      return res.status(401).json({ error: 'Invalid refresh token' });
    }

    const stored = await query(
      'SELECT * FROM refresh_tokens WHERE token = $1 AND user_id = $2 AND expires_at > NOW()',
      [refreshToken, decoded.userId]
    );
    if (!stored.rows[0]) return res.status(401).json({ error: 'Refresh token expired or revoked' });

    // Rotate
    await query('DELETE FROM refresh_tokens WHERE token = $1', [refreshToken]);
    const { accessToken, refreshToken: newRefreshToken } = generateTokens(decoded.userId);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    await query(
      'INSERT INTO refresh_tokens (user_id, token, expires_at) VALUES ($1, $2, $3)',
      [decoded.userId, newRefreshToken, expiresAt]
    );

    res.json({ accessToken, refreshToken: newRefreshToken });
  } catch (err) { next(err); }
};

const logout = async (req, res, next) => {
  try {
    const { refreshToken } = req.body;
    if (refreshToken) {
      await query('DELETE FROM refresh_tokens WHERE token = $1', [refreshToken]);
    }
    res.json({ message: 'Logged out successfully' });
  } catch (err) { next(err); }
};

const getMe = async (req, res, next) => {
  try {
    const result = await query(
      `SELECT user_id, username, display_name, email, bio, avatar_url, cover_url,
              is_verified, role, followers_count, following_count,
              total_questions, total_correct, total_answers, created_at
       FROM users WHERE user_id = $1`,
      [req.user.user_id]
    );
    res.json(result.rows[0]);
  } catch (err) { next(err); }
};

module.exports = { register, login, refresh, logout, getMe };
