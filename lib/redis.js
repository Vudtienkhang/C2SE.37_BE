import Redis from 'ioredis';
import dotenv from 'dotenv';

dotenv.config();

const redisUrl = process.env.REDIS_URL || 'redis://127.0.0.1:6379';

// Cấu hình TLS nếu link bắt đầu bằng rediss:// (Dùng cho Upstash)
const redisOptions = {
  maxRetriesPerRequest: null, // REQUIRED for BullMQ
};

if (redisUrl.startsWith('rediss://')) {
  redisOptions.tls = {
    rejectUnauthorized: false
  };
}

const redis = new Redis(redisUrl, redisOptions);

redis.on('connect', () => {
  console.log('[REDIS] Connected successfully');
});

redis.on('error', (err) => {
  console.error('[REDIS] Connection error:', err);
});

export default redis;
