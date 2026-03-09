require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const path = require('path');

const { errorHandler } = require('./middleware/errorHandler');
const { rateLimiter } = require('./middleware/rateLimiter');

const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/users');
const questionRoutes = require('./routes/questions');
const feedRoutes = require('./routes/feed');
const notificationRoutes = require('./routes/notifications');
const categoryRoutes = require('./routes/categories');
const searchRoutes = require('./routes/search');
const uploadRoutes = require('./routes/upload');

const app = express();

// ─── Security & Middleware ────────────────────────────────────
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, curl, Postman)
    if (!origin) return callback(null, true);
    // Allow all origins in development
    if (process.env.NODE_ENV !== 'production') return callback(null, true);
    // In production, allow configured frontend + any onrender.com domain
    const allowed = [
      process.env.FRONTEND_URL,
      'http://localhost:3000',
    ].filter(Boolean);
    const isOnRender = origin.endsWith('.onrender.com');
    if (allowed.includes(origin) || isOnRender) {
      callback(null, true);
    } else {
      console.warn('CORS blocked origin:', origin);
      callback(null, true); // temporarily allow all to debug
    }
  },
  credentials: true,
}));
app.use(compression());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
if (process.env.NODE_ENV !== 'test') {
  app.use(morgan('dev'));
}

// ─── Static Files ─────────────────────────────────────────────
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// ─── Health Check (no rate limit) ────────────────────────────
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', version: '1.0.0', timestamp: new Date().toISOString() });
});

// ─── Rate Limiting ────────────────────────────────────────────
app.use('/api/', rateLimiter);

// ─── API Routes ───────────────────────────────────────────────
app.use('/api/auth', authRoutes);
app.use('/api/users', userRoutes);
app.use('/api/questions', questionRoutes);
app.use('/api/feed', feedRoutes);
app.use('/api/notifications', notificationRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/search', searchRoutes);
app.use('/api/upload', uploadRoutes);

// ─── Debug Endpoint ──────────────────────────────────────────
app.get('/api/debug', async (req, res) => {
  const { query } = require('./config/database');
  try {
    const result = await query("SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'users') as users_exist");
    res.json({
      db_connected: true,
      users_table: result.rows[0].users_exist,
      env: {
        node_env: process.env.NODE_ENV,
        has_jwt: !!process.env.JWT_SECRET,
        has_db: !!process.env.DATABASE_URL,
        frontend_url: process.env.FRONTEND_URL,
      }
    });
  } catch (err) {
    res.json({ db_connected: false, error: err.message });
  }
});

// ─── 404 Handler ─────────────────────────────────────────────
app.use('*', (req, res) => {
  res.status(404).json({ error: `Route ${req.method} ${req.originalUrl} not found` });
});

// ─── Error Handler ────────────────────────────────────────────
app.use(errorHandler);

// ─── Start Server ─────────────────────────────────────────────
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`\n🚀 QuizZer API running on port ${PORT}`);
  console.log(`   Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`   URL: http://localhost:${PORT}\n`);
});

module.exports = app;
