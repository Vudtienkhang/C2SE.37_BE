import prisma from '../prisma/prisma.js';
import redis from '../lib/redis.js';

export const findNearbyDrivers = async (req, res) => {
  const { lat, lng, radius = 5 } = req.query; // Radius mặc định 5km
  console.log(`[BACKEND] Finding nearby drivers at: lat=${lat}, lng=${lng}, radius=${radius}`);

  if (!lat || !lng) {
    return res.status(400).json({ message: 'Vui lòng cung cấp tọa độ lat và lng' });
  }

  try {
    // 1. Sử dụng Redis GEOSEARCH để tìm các driverId trong bán kính radius
    // 'drivers:locations' là key chứa dữ liệu vị trí
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

    // nearbyDriverIds có dạng: [ [id, distance], [id, distance], ... ]
    const driverIds = nearbyDriverIds.map(item => parseInt(item[0]));

    // 2. Lấy thông tin chi tiết từ DB (chỉ lấy những ông đang online và không bận)
    // Lưu ý: isOnline hiện tại vẫn nên track trong DB hoặc Redis
    const driversInfo = await prisma.driver.findMany({
      where: {
        id: { in: driverIds },
        isOnline: true, // Vẫn dùng DB làm source of truth cho trạng thái
        isBusy: false,
        status: 'approved'
      },
      include: {
        user: { select: { fullName: true, phone: true } }
      }
    });

    // 3. Map lại khoảng cách từ Redis vào kết quả
    const results = driversInfo.map(driver => {
      const redisData = nearbyDriverIds.find(item => parseInt(item[0]) === driver.id);
      return {
        ...driver,
        distance: redisData ? parseFloat(redisData[1]) : 0
      };
    }).sort((a, b) => a.distance - b.distance);

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

