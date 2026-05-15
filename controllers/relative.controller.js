import prisma from '../prisma/prisma.js';
import redis from '../lib/redis.js';

export const getRelatives = async (req, res) => {
  try {
    const { userId } = req.params;
    
    const relatives = await prisma.relative.findMany({
      where: { userId: parseInt(userId, 10) },
      orderBy: { createdAt: 'desc' }
    });

    res.status(200).json({ success: true, data: relatives });
  } catch (error) {
    console.error("Error getting relatives:", error);
    res.status(500).json({ success: false, message: "Internal server error", error: error.message });
  }
};

export const addRelative = async (req, res) => {
  try {
    const { userId } = req.params;
    const { name, phone } = req.body;

    const newRelative = await prisma.relative.create({
      data: {
        userId: parseInt(userId, 10),
        name,
        phone
      }
    });

    res.status(201).json({ success: true, data: newRelative, message: "Người thân đã được thêm thành công" });
  } catch (error) {
    console.error("Error adding relative:", error);
    res.status(500).json({ success: false, message: "Internal server error", error: error.message });
  }
};

export const updateRelative = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, phone } = req.body;

    const updatedRelative = await prisma.relative.update({
      where: { id: parseInt(id, 10) },
      data: {
        name,
        phone
      }
    });

    res.status(200).json({ success: true, data: updatedRelative, message: "Cập nhật thông tin thành công" });
  } catch (error) {
    console.error("Error updating relative:", error);
    res.status(500).json({ success: false, message: "Internal server error", error: error.message });
  }
};

export const deleteRelative = async (req, res) => {
  try {
    const { id } = req.params;

    await prisma.relative.delete({
      where: { id: parseInt(id, 10) }
    });

    res.status(200).json({ success: true, message: "Đã xóa người thân khỏi danh sách" });
  } catch (error) {
    console.error("Error deleting relative:", error);
    res.status(500).json({ success: false, message: "Internal server error", error: error.message });
  }
};

export const getTrackingTrips = async (req, res) => {
  try {
    const { userId } = req.params;
    
    // Bảo mật: Chỉ cho phép người dùng xem thông tin của chính mình
    if (req.user.id !== parseInt(userId, 10)) {
      return res.status(403).json({ success: false, message: "Bạn không có quyền truy cập thông tin này" });
    }

    // 1. Lấy số điện thoại của người dùng hiện tại (Người đang muốn theo dõi)
    const currentUser = await prisma.user.findUnique({
      where: { id: parseInt(userId, 10) },
      select: { phone: true }
    });

    if (!currentUser) {
      return res.status(404).json({ success: false, message: "Không tìm thấy người dùng" });
    }

    // 2. Tìm tất cả những người đã thêm số điện thoại này làm người thân
    const linkedRelatives = await prisma.relative.findMany({
      where: { phone: currentUser.phone },
      select: { userId: true }
    });

    if (linkedRelatives.length === 0) {
      return res.status(200).json({ success: true, data: [], message: "Chưa có ai đăng ký bạn là người thân" });
    }

    const relativeUserIds = linkedRelatives.map(r => r.userId);

    // 3. Lấy thông tin cơ bản của những người này
    const relativesInfo = await prisma.user.findMany({
      where: { id: { in: relativeUserIds } },
      select: { 
        id: true, 
        fullName: true, 
        avatarUrl: true, 
        phone: true,
        customer: {
          select: { id: true }
        }
      }
    });

    // 4. Tìm các chuyến đi đang hoạt động của những người này
    const activeTrips = await prisma.trip.findMany({
      where: {
        customer: {
          userId: { in: relativeUserIds }
        },
        status: { in: ['accepted', 'arrived', 'started'] }
      },
      include: {
        driver: {
          include: { user: { select: { fullName: true, phone: true } } }
        }
      }
    });

    // 5. Tổng hợp dữ liệu: Chuyến đi + Vị trí từ Redis
    const results = await Promise.all(relativesInfo.map(async (rel) => {
      // Tìm xem người này có chuyến đi nào không
      const activeTrip = activeTrips.find(t => t.customerId === rel.customer?.id);
      
      let lastLocation = null;
      let locationSource = 'user'; // 'user' hoặc 'trip'

      // Ưu tiên lấy vị trí tài xế nếu đang trong chuyến đi
      if (activeTrip && activeTrip.driverId) {
        const tripLoc = await redis.get(`driver:${activeTrip.driverId}:last_location`);
        if (tripLoc) {
          lastLocation = JSON.parse(tripLoc);
          locationSource = 'trip';
        }
      }

      // Nếu không có vị trí chuyến đi, lấy vị trí cá nhân của người đó
      if (!lastLocation) {
        const userLoc = await redis.get(`user:${rel.id}:last_location`);
        if (userLoc) {
          lastLocation = JSON.parse(userLoc);
        }
      }

      return {
        relativeId: rel.id,
        fullName: rel.fullName,
        avatarUrl: rel.avatarUrl,
        phone: rel.phone,
        activeTrip: activeTrip || null,
        lastLocation,
        locationSource
      };
    }));

    res.status(200).json({ success: true, data: results });
  } catch (error) {
    console.error("Error getting tracking trips:", error);
    res.status(500).json({ success: false, message: "Internal server error", error: error.message });
  }
};
