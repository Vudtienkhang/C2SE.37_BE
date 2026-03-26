import prisma from '../prisma/prisma.js';
import redis from '../lib/redis.js';
import { getConfig } from '../services/config.service.js';

export const findNearbyDrivers = async (req, res) => {
  const { lat, lng, radius = 5 } = req.query; // Radius mặc định 5km
  console.log(`[BACKEND] Finding nearby drivers at: lat=${lat}, lng=${lng}, radius=${radius}`);

  if (!lat || !lng) {
    return res.status(400).json({ message: 'Vui lòng cung cấp tọa độ lat và lng' });
  }

  try {
    // 0. Lấy bảng hệ số ưu tiên từ Config
    const priorities = await getConfig('DRIVER_RANK_PRIORITY', {
      SILVER: 1.0,
      GOLD: 1.1,
      PLATINUM: 1.25,
      DIAMOND: 1.5
    });

    // 1. Sử dụng Redis GEOSEARCH để tìm các driverId trong bán kính radius
    const nearbyDriverIds = await redis.geosearch(
      'drivers:locations',
      'FROMLONLAT', lng, lat,
      'BYRADIUS', radius, 'km',
      'WITHDIST',
      'ASC'
    );

    if (!nearbyDriverIds || nearbyDriverIds.length === 0) {
      return res.status(200).json([]);
    }

    const driverIds = nearbyDriverIds.map(item => parseInt(item[0]));

    // 2. Lấy thông tin chi tiết từ DB (chỉ lấy những ông đang online và không bận)
    const driversInfo = await prisma.driver.findMany({
      where: {
        id: { in: driverIds },
        isOnline: true,
        isBusy: false,
        status: 'approved'
      },
      include: {
        user: { select: { fullName: true, phone: true } },
        DriverRank: true // Lấy thêm Rank để tính ưu tiên
      }
    });

    // 3. Tính toán "Khoảng cách hiệu dụng" (Effective Distance) dựa trên Rank
    const results = driversInfo.map(driver => {
      const redisData = nearbyDriverIds.find(item => parseInt(item[0]) === driver.id);
      const actualDistance = redisData ? parseFloat(redisData[1]) : 0;
      
      // Lấy hệ số ưu tiên từ Rank (mặc định 1.0)
      const multiplier = priorities[driver.DriverRank?.code] || 1.0;
      const effectiveDistance = actualDistance / multiplier;

      return {
        ...driver,
        actualDistance,
        effectiveDistance,
        priorityMultiplier: multiplier
      };
    }).sort((a, b) => a.effectiveDistance - b.effectiveDistance); // Sắp xếp theo khoảng cách hiệu dụng

    res.status(200).json(results);
  } catch (error) {
    console.error('Error finding nearby drivers:', error);
    res.status(500).json({ message: 'Lỗi server khi tìm tài xế' });
  }
};

export const updateStatus = async (req, res) => {
  try {
    const { driverId } = req.params;
    const { isOnline } = req.body;
    console.log(`[BACKEND] Received updateStatus request: driverId=${driverId}, isOnline=${isOnline}`);

    const driver = await prisma.driver.update({

      where: { id: parseInt(driverId) },
      data: { isOnline: !!isOnline },
    });

    res.json({ success: true, isOnline: driver.isOnline });
  } catch (error) {
    console.error('Error updating driver status:', error);
    res.status(500).json({ message: 'Lỗi khi cập nhật trạng thái' });
  }
};

