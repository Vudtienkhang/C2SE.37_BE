import prisma from '../prisma/prisma.js';

/**
 * Lấy thống kê thu nhập và lịch sử chuyến đi của tài xế
 * @param {number} userId - ID của User (liên kết với Driver)
 */
/**
 * Lấy thống kê thu nhập và lịch sử chuyến đi của tài xế
 * @param {number} userId - ID của User (liên kết với Driver)
 * @param {string} startDateISO - Ngày bắt đầu (ISO string)
 * @param {string} endDateISO - Ngày kết thúc (ISO string)
 */
export const getDriverEarningsStats = async (userId, startDateISO, endDateISO) => {
  const driver = await prisma.driver.findUnique({
    where: { userId: parseInt(userId) },
    include: {
      user: { include: { wallet: true } }
    }
  });

  if (!driver) throw new Error('Không tìm thấy tài xế');

  const now = new Date();
  let start, end;

  if (startDateISO && endDateISO) {
    start = new Date(startDateISO);
    end = new Date(endDateISO);
    // Đảm bảo end bao gồm hết cả ngày đó (23:59:59) nếu chỉ nhận được YYYY-MM-DD
    if (end.getHours() === 0 && end.getMinutes() === 0) {
      end.setHours(23, 59, 59, 999);
    }
  } else {
    // Mặc định là ngày hôm nay theo múi giờ Việt Nam (GMT+7)
    const vnNow = new Date(now.getTime() + 7 * 60 * 60 * 1000);
    const vnStart = new Date(vnNow.getUTCFullYear(), vnNow.getUTCMonth(), vnNow.getUTCDate());
    // Lấy mốc 00:00:00 VN (quy đổi về UTC để query DB)
    start = new Date(vnStart.getTime() - 7 * 60 * 60 * 1000);
    // Kết thúc lúc 23:59:59.999 VN
    end = new Date(start.getTime() + 24 * 60 * 60 * 1000 - 1);
  }

  const defaultRate = driver.DriverRank?.platformRate ?? 20;

  // 1. Thống kê theo khoảng thời gian đã chọn
  const periodTrips = await prisma.trip.findMany({
    where: {
      driverId: driver.id,
      createdAt: { gte: start, lte: end }
    },
    include: { commissions: true }
  });

  const completedPeriod = periodTrips.filter(t => t.status === 'completed');
  
  const periodIncome = completedPeriod.reduce((acc, trip) => {
    const commission = trip.commissions[0]?.commissionAmount ?? ( (trip.priceEstimate || trip.finalPrice || 0) * (defaultRate / 100) );
    const originalPrice = trip.priceEstimate || trip.finalPrice || 0;
    return acc + (originalPrice - commission);
  }, 0);

  // 2. Weekly stats (Vẫn giữ để hiển thị nhanh nếu cần, hoặc có thể dùng periodIncome nếu chọn theo tuần)
  // Logic lấy tuần này của hệ thống
  const tempDate = new Date(now);
  const day = tempDate.getDay();
  const diff = tempDate.getDate() - day + (day === 0 ? -6 : 1);
  const weekStart = new Date(tempDate.setDate(diff));
  weekStart.setHours(0, 0, 0, 0);

  const weeklyTrips = await prisma.trip.findMany({
    where: {
      driverId: driver.id,
      status: 'completed',
      createdAt: { gte: weekStart }
    },
    include: { commissions: true }
  });

  const weeklyIncome = weeklyTrips.reduce((acc, trip) => {
    const commission = trip.commissions[0]?.commissionAmount ?? ( (trip.priceEstimate || trip.finalPrice || 0) * (defaultRate / 100) );
    const originalPrice = trip.priceEstimate || trip.finalPrice || 0;
    return acc + (originalPrice - commission);
  }, 0);

  // 3. Recent trips (last 20 - Hiển thị ở mục Lịch sử gần đây)
  const recentTrips = await prisma.trip.findMany({
    where: {
      driverId: driver.id,
      status: 'completed'
    },
    include: {
      commissions: true,
      conversation: {
        include: {
          messages: {
            where: {
              isRead: false,
              senderId: { not: parseInt(userId) }
            },
            select: { id: true }
          },
          _count: {
            select: { messages: true }
          }
        }
      }
    },
    orderBy: { createdAt: 'desc' },
    take: 20
  });

  const mappedRecentTrips = recentTrips.map(trip => {
    const commission = trip.commissions[0]?.commissionAmount ?? ( (trip.priceEstimate || trip.finalPrice || 0) * (defaultRate / 100) );
    const originalPrice = trip.priceEstimate || trip.finalPrice || 0;
    return {
      id: trip.id,
      createdAt: trip.createdAt,
      distanceKm: trip.distanceKm,
      finalPrice: trip.finalPrice,
      originalPrice,
      commission,
      driverIncome: originalPrice - commission,
      hasMessages: (trip.conversation?._count?.messages || 0) > 0,
      unreadCount: trip.conversation?.messages?.length || 0
    };
  });

  // 4. Tính toán Online Time theo khoảng thời gian đã chọn
  const onlineSessions = await prisma.onlineSession.findMany({
    where: {
      driverId: driver.id,
      startTime: { lte: end },
      OR: [
        { endTime: null },
        { endTime: { gte: start } }
      ]
    }
  });

  let totalOnlineMs = 0;
  onlineSessions.forEach(session => {
    const sessionStart = new Date(Math.max(new Date(session.startTime).getTime(), start.getTime()));
    const sessionEnd = session.endTime 
      ? new Date(Math.min(new Date(session.endTime).getTime(), end.getTime()))
      : new Date(Math.min(now.getTime(), end.getTime()));
    
    const duration = sessionEnd.getTime() - sessionStart.getTime();
    if (duration > 0) {
      totalOnlineMs += duration;
    }
  });

  const hours = Math.floor(totalOnlineMs / (1000 * 60 * 60));
  const minutes = Math.floor((totalOnlineMs % (1000 * 60 * 60)) / (1000 * 60));
  const onlineTimeStr = `${hours}h ${minutes}m`;

  // 5. Acceptance Rate theo khoảng thời gian
  const periodOffers = await prisma.tripOffer.count({
    where: {
      driverId: driver.id,
      offeredAt: { gte: start, lte: end }
    }
  });

  const periodAccepted = await prisma.tripOffer.count({
    where: {
      driverId: driver.id,
      status: 'ACCEPTED',
      offeredAt: { gte: start, lte: end }
    }
  });

  const acceptanceRateVal = periodOffers > 0 
    ? Math.round((periodAccepted / periodOffers) * 100) 
    : 100;

  // 6. Performance Rate (Vẫn giữ toàn thời gian hoặc theo khoảng thời gian nếu muốn)
  const totalCompleted = await prisma.trip.count({
    where: {
      driverId: driver.id,
      status: 'completed'
    }
  });

  const totalCancelled = await prisma.trip.count({
    where: {
      driverId: driver.id,
      status: 'cancelled'
    }
  });

  const performanceRate = (totalCompleted + totalCancelled) > 0
    ? Math.round((totalCompleted / (totalCompleted + totalCancelled)) * 100)
    : 100;

  return {
    success: true,
    data: {
      period: {
        income: periodIncome,
        tripCount: completedPeriod.length,
        onlineTime: onlineTimeStr, 
        acceptanceRate: `${acceptanceRateVal}%`,
        performanceRate: `${performanceRate}%`
      },
      today: { // Thêm trường today tương thích với DriverHome.tsx
        income: periodIncome,
        tripCount: completedPeriod.length
      },
      weeklyIncome,
      walletBalance: driver.user.wallet?.balance || 0,
      recentTrips: mappedRecentTrips
    }
  };
};
