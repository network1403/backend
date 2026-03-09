const errorHandler = (err, req, res, next) => {
  console.error('Error:', err.message || err);

  // PostgreSQL errors
  if (err.code === '23505') return res.status(409).json({ error: 'Already exists', detail: err.detail });
  if (err.code === '23503') return res.status(400).json({ error: 'Referenced resource not found' });
  if (err.code === '22P02') return res.status(400).json({ error: 'Invalid UUID format' });

  const status = err.status || err.statusCode || 500;
  const message =
    process.env.NODE_ENV === 'production' && status >= 500
      ? 'Internal server error'
      : err.message || 'Something went wrong';

  res.status(status).json({ error: message });
};

module.exports = { errorHandler };
