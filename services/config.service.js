import prisma from '../prisma/prisma.js';
import redis from '../lib/redis.js';

const CACHE_PREFIX = 'config:';
const CACHE_TTL = 3600; // 1 hour

/**
 * Lấy giá trị cấu hình hệ thống (Có cache Redis)
 * @param {string} key - Key cấu hình
 * @param {any} defaultValue - Giá trị mặc định nếu không tìm thấy
 * @returns {Promise<any>}
 */
export const getConfig = async (key, defaultValue = null) => {
  try {
    // 1. Kiểm tra trong Redis Cache
    const cachedValue = await redis.get(`${CACHE_PREFIX}${key}`);
    if (cachedValue) {
      try {
        return JSON.parse(cachedValue);
      } catch (e) {
        return cachedValue;
      }
    }

    // 2. Nếu không có trong Cache, lấy từ DB
    const config = await prisma.systemConfig.findUnique({
      where: { key }
    });

    if (!config) {
      return defaultValue;
    }

    // 3. Lưu vào Redis và trả về
    await redis.setex(`${CACHE_PREFIX}${key}`, CACHE_TTL, config.value);

    try {
      return JSON.parse(config.value);
    } catch (e) {
      return config.value;
    }
  } catch (error) {
    console.error(`[CONFIG SERVICE] Error getting config for ${key}:`, error);
    return defaultValue;
  }
};

/**
 * Xóa cache của một key cụ thể hoặc tất cả cấu hình
 * @param {string} [key] - Key cần xóa cache (optional)
 */
export const refreshConfig = async (key = null) => {
  if (key) {
    await redis.del(`${CACHE_PREFIX}${key}`);
    console.log(`[CONFIG SERVICE] Cache cleared for: ${key}`);
  } else {
    const keys = await redis.keys(`${CACHE_PREFIX}*`);
    if (keys.length > 0) {
      await redis.del(...keys);
    }
    console.log(`[CONFIG SERVICE] All config cache cleared`);
  }
};
