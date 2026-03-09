const express = require('express');
const router = express.Router();
const { query } = require('../config/database');
const { cache } = require('../config/redis');

router.get('/', async (req, res, next) => {
  try {
    const cached = await cache.get('categories:all');
    if (cached) return res.json(cached);

    const result = await query(
      'SELECT * FROM categories WHERE is_active = true ORDER BY display_order'
    );
    await cache.set('categories:all', result.rows, 3600);
    res.json(result.rows);
  } catch (err) { next(err); }
});

module.exports = router;
