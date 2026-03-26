import prisma from '../prisma/prisma.js';

/**
 * Kiểm tra và hạ hạng tài xế nếu không duy trì đủ hiệu suất trong 30 ngày qua
 * Thường chạy định kỳ (ví dụ: ngày 1 hàng tháng)
 */
export const verifyDriverRanks = async () => {
  console.log('[MAINTENANCE] Starting monthly rank verification...');
  
  try {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    // 1. Lấy tất cả tài xế có hạng > SILVER (ID 1 là SILVER)
    const drivers = await prisma.driver.findMany({
      where: {
        rankId: { not: 1, notIn: [null] }
      },
      include: { DriverRank: true }
    });

    let downgradedCount = 0;

    for (const driver of drivers) {
      // 2. Đếm số chuyến đi hoàn thành trong 30 ngày qua
      const tripsCount = await prisma.trip.count({
        where: {
          driverId: driver.id,
          status: 'completed',
          createdAt: { gte: thirtyDaysAgo }
        }
      });

      // 3. Nếu số chuyến thấp hơn mức tối thiểu của hạng hiện tại -> Hạ 1 bậc
      if (tripsCount < driver.DriverRank.minTrips) {
        // Tìm hạng liền kề thấp hơn
        const lowerRank = await prisma.driverRank.findFirst({
          where: {
            minTrips: { lt: driver.DriverRank.minTrips }
          },
          orderBy: { minTrips: 'desc' }
        });

        if (lowerRank) {
          await prisma.driver.update({
            where: { id: driver.id },
            data: { rankId: lowerRank.id }
          });
          console.log(`[MAINTENANCE] Driver ${driver.id} downgraded: ${driver.DriverRank.name} -> ${lowerRank.name} (Trips: ${tripsCount}/${driver.DriverRank.minTrips})`);
          downgradedCount++;
        }
      }
    }

    console.log(`[MAINTENANCE] Rank verification completed. Drivers downgraded: ${downgradedCount}`);
    return { success: true, downgradedCount };
  } catch (error) {
    console.error('[MAINTENANCE ERROR] Rank verification failed:', error);
    return { success: false, error: error.message };
  }
};
