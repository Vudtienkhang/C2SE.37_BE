import Redis from 'ioredis';
import dotenv from 'dotenv';

dotenv.config();

const redisUrl = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

const redisOptions = {
  maxRetriesPerRequest: null, 
};

// Tự động bật TLS nếu URL có rediss:// hoặc là host của Upstash
if (redisUrl.startsWith('rediss://') || redisUrl.includes('upstash.io')) {
  redisOptions.tls = {
    rejectUnauthorized: false
  };
  console.log('[REDIS] SSL/TLS mode enabled');
}

const redis = new Redis(redisUrl, redisOptions);

redis.on('connect', () => {
  console.log('[REDIS] Connected successfully');
});

redis.on('error', (err) => {
  console.error('[REDIS] Connection error:', err);
});

export default redis;
