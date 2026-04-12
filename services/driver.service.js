import prisma from '../prisma/prisma.js';

/**
 * Lấy thống kê thu nhập và lịch sử chuyến đi của tài xế
 * @param {number} userId - ID của User (liên kết với Driver)
 */
export const getDriverEarningsStats = async (userId) => {
  const driver = await prisma.driver.findUnique({
    where: { userId: parseInt(userId) },
    include: {
      user: { include: { wallet: true } }
    }
  });

  if (!driver) throw new Error('Không tìm thấy tài xế');

  const now = new Date();
  
  // Today's boundaries
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

  // Week's boundaries (Starts on Monday)
  const tempDate = new Date(now);
  const day = tempDate.getDay();
  const diff = tempDate.getDate() - day + (day === 0 ? -6 : 1);
  const weekStart = new Date(tempDate.setDate(diff));
  weekStart.setHours(0, 0, 0, 0);

  // 1. Today's stats
  const dailyTrips = await prisma.trip.findMany({
    where: {
      driverId: driver.id,
      status: 'completed',
      createdAt: { gte: todayStart, lte: todayEnd }
    },
    include: { commissions: true }
  });

  const defaultRate = driver.DriverRank?.platformRate ?? 20;

  const dailyIncome = dailyTrips.reduce((acc, trip) => {
    const commission = trip.commissions[0]?.commissionAmount ?? ( (trip.priceEstimate || trip.finalPrice || 0) * (defaultRate / 100) );
    const originalPrice = trip.priceEstimate || trip.finalPrice || 0;
    return acc + (originalPrice - commission);
  }, 0);

  // 2. Weekly stats
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

  // 3. Recent trips (last 20)
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
            select: { id: true } // Chỉ lấy ID để tối ưu, chúng ta chỉ cần đếm số lượng
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

  return {
    success: true,
    data: {
      today: {
        income: dailyIncome,
        tripCount: dailyTrips.length,
        onlineTime: "5h 30m", // Placeholder, logic tracking session có thể bổ sung sau
        acceptanceRate: "98%" // Placeholder
      },
      weeklyIncome,
      walletBalance: driver.user.wallet?.balance || 0,
      recentTrips: mappedRecentTrips
    }
  };
};
