const { createClient } = require('redis');

let client = null;
let isConnected = false;

const initRedis = async () => {
  if (client) return;

  client = createClient({
    url: process.env.REDIS_URL || 'redis://localhost:6379',
    socket: { connectTimeout: 3000, reconnectStrategy: (retries) => retries > 3 ? false : retries * 500 },
  });

  client.on('error', (err) => {
    if (isConnected) console.warn('Redis error (cache disabled):', err.message);
    isConnected = false;
  });
  client.on('ready', () => {
    isConnected = true;
    console.log('✅ Redis connected');
  });
  client.on('end', () => { isConnected = false; });

  try {
    await client.connect();
  } catch {
    console.warn('⚠️  Redis unavailable — running without cache');
  }
};

// Initialize on load
initRedis().catch(() => {});

const cache = {
  async get(key) {
    try {
      if (!isConnected) return null;
      const val = await client.get(key);
      return val ? JSON.parse(val) : null;
    } catch { return null; }
  },

  async set(key, value, ttlSeconds = 300) {
    try {
      if (!isConnected) return;
      await client.setEx(key, ttlSeconds, JSON.stringify(value));
    } catch { /* silent */ }
  },

  async del(...keys) {
    try {
      if (!isConnected) return;
      await client.del(keys);
    } catch { /* silent */ }
  },

  async delPattern(pattern) {
    try {
      if (!isConnected) return;
      const keys = await client.keys(pattern);
      if (keys.length > 0) await client.del(keys);
    } catch { /* silent */ }
  },
};

module.exports = { cache };
