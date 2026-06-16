import prisma from '../prisma/prisma.js';
import redis from '../lib/redis.js';
import logger from '../lib/logger.js';
import { getConfig } from './config.service.js';

export const SCORE_REASONS = {
  TRIP_COMPLETED: 'Hoàn thành chuyến đi',
  RATING_5_STAR: 'Đánh giá 5 sao',
  RATING_4_STAR: 'Đánh giá 4 sao',
  RATING_3_STAR: 'Đánh giá 3 sao',
  RATING_2_STAR: 'Đánh giá 2 sao',
  RATING_1_STAR: 'Đánh giá 1 sao',
  TRIP_CANCELLED: 'Hủy chuyến đi',
  PEAK_HOUR_BONUS: 'Thưởng giờ cao điểm',
  NIGHT_TRIP_BONUS: 'Thưởng chuyến đi đêm',
  LONG_TRIP_BONUS: 'Thưởng chuyến đi đường dài',
  COMPLAINT: 'Khiếu nại từ khách hàng',
};

// Mặc định (Fallback) nếu DB không có cấu hình
const DEFAULT_SCORE_VALUES = {
  TRIP_COMPLETED: 10,
  RATING_5_STAR: 5,
  RATING_4_STAR: 2,
  RATING_3_STAR: 0,
  RATING_2_STAR: -5,
  RATING_1_STAR: -10,
  TRIP_CANCELLED: -20,
  PEAK_HOUR_BONUS: 5,
  NIGHT_TRIP_BONUS: 5,
  LONG_TRIP_BONUS: 10,
  COMPLAINT: -50,
};

/**
 * Cập nhật điểm số cho tài xế và đồng bộ lên Redis Leaderboard
 * @param {number} driverId - ID của tài xế
 * @param {string} reason - Lý do thay đổi điểm (từ SCORE_REASONS)
 * @param {number} [tripId] - (Optional) ID chuyến đi liên quan
 */
export const updateDriverScore = async (driverId, reason, tripId = null) => {
  const driverIdInt = parseInt(driverId);
  // Lấy bảng điểm từ Config (Động)
  const policy = await getConfig('DRIVER_SCORE_POLICY', DEFAULT_SCORE_VALUES);
  let amount = policy[reason] !== undefined ? parseInt(policy[reason]) : 0;
  
  logger.debug({ reason, amount }, '[SCORE] Calculating point change');
  
  if (amount === 0 && reason !== 'RATING_3_STAR') {
    logger.debug({ reason }, '[SCORE] Amount is 0, skipping update');
    return;
  }

  try {
      const result = await prisma.$transaction(async (tx) => {
      // 1. Cập nhật totalPoints của tài xế
      const driver = await tx.driver.update({
        where: { id: driverIdInt },
        data: { totalPoints: { increment: amount } },
        select: { id: true, totalPoints: true }
      });

      // 2. Lưu log lịch sử điểm
      await tx.driverPointLog.create({
        data: {
          driverId: driverIdInt,
          amount,
          reason: SCORE_REASONS[reason] || reason,
          tripId: tripId ? parseInt(tripId) : null
        }
      });

      return driver;
    }, { timeout: 15000 });

    // 3. Đồng bộ lên Redis Leaderboard (ZSET)
    // Key: 'leaderboard:drivers'
    await redis.zadd('leaderboard:drivers', result.totalPoints, driverIdInt.toString());

    // Phát sự kiện real-time qua socket tới tài xế
    try {
        const { emitToUser } = await import('./socket.service.js');
        const driver = await prisma.driver.findUnique({ 
            where: { id: driverIdInt }, 
            select: { userId: true } 
        });
        if (driver) {
            emitToUser(driver.userId, 'score:updated', {
                amount,
                reason: SCORE_REASONS[reason] || reason,
                totalPoints: result.totalPoints
            });
        }
    } catch (socketError) {
        console.warn('[SCORE] Failed to emit socket event:', socketError.message);
    }

    logger.info(`[SCORE] Updated driver ${driverIdInt}: ${amount} pts (Reason: ${reason}). Total: ${result.totalPoints}`);
    return result;
  } catch (error) {
    console.error(`[SCORE ERROR] Failed to update score for driver ${driverId}:`, error);
  }
};

/**
 * Láy danh sách Top tài xế từ Redis Leaderboard
 * @param {number} limit - Số lượng tài xế muốn lấy
 */
export const getTopDrivers = async (limit = 10) => {
  try {
    // ZREVRANGE lấy theo thứ tự điểm giảm dần
    const topIdsWithScores = await redis.zrevrange('leaderboard:drivers', 0, limit - 1, 'WITHSCORES');
    
    // Redis trả về mảng phẳng [id1, score1, id2, score2, ...]
    const results = [];
    for (let i = 0; i < topIdsWithScores.length; i += 2) {
      results.push({
        driverId: parseInt(topIdsWithScores[i]),
        score: parseFloat(topIdsWithScores[i + 1])
      });
    }

    // Lấy thêm thông tin chi tiết từ DB
    const driverDetails = await prisma.driver.findMany({
      where: { id: { in: results.map(r => r.driverId) } },
      include: { user: { select: { fullName: true, avatarUrl: true } } }
    });

    return results.map(r => ({
      ...r,
      driver: driverDetails.find(d => d.id === r.driverId)
    }));
  } catch (error) {
    console.error('[SCORE ERROR] Failed to fetch top drivers:', error);
    return [];
  }
};

/**
 * Lấy lịch sử điểm của tài xế
 * @param {number} userId - ID người dùng
 */
export const getPointLogs = async (userId) => {
  const driver = await prisma.driver.findUnique({
    where: { userId: parseInt(userId) },
    select: { id: true }
  });

  if (!driver) throw new Error('Driver not found');

  return prisma.driverPointLog.findMany({
    where: { driverId: driver.id },
    orderBy: { createdAt: 'desc' },
    take: 50
  });
};
