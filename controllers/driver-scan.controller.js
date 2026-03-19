import prisma from '../prisma/prisma.js';

// Công thức Haversine để tính khoảng cách giữa 2 điểm (km)
const getDistance = (lat1, lon1, lat2, lon2) => {
  const R = 6371; // Bán kính Trái đất
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = 
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
    Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
};

export const findNearbyDrivers = async (req, res) => {
  const { lat, lng, radius = 5 } = req.query; // Radius mặc định 5km
  console.log(`[BACKEND] Finding nearby drivers at: lat=${lat}, lng=${lng}, radius=${radius}`);

  if (!lat || !lng) {
    console.warn(`[BACKEND] Missing lat or lng in nearby drivers request: lat=${lat}, lng=${lng}`);
    return res.status(400).json({ message: 'Vui lòng cung cấp tọa độ lat và lng' });
  }

  try {
    // 1. Lấy tất cả tài xế đang online và không bận
    // Lưu ý: Nếu dữ liệu lớn, nên dùng bounding box trước khi tính khoảng cách chi tiết
    const drivers = await prisma.driver.findMany({
      where: {
        isOnline: true,
        isBusy: false,
        currentLat: { not: null },
        currentLng: { not: null },
        status: 'approved'
      },
      include: {
        user: {
          select: {
            fullName: true,
            phone: true
          }
        }
      }
    });

    // 2. Lọc theo bán kính sử dụng Haversine
    const nearbyDrivers = drivers
      .map(driver => ({
        ...driver,
        distance: getDistance(parseFloat(lat), parseFloat(lng), driver.currentLat, driver.currentLng)
      }))
      .filter(driver => driver.distance <= parseFloat(radius))
      .sort((a, b) => a.distance - b.distance); // Sắp xếp từ gần tới xa

    res.status(200).json(nearbyDrivers);
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

