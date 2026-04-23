import prisma from '../prisma/prisma.js';

export const getAllAlerts = async (req, res) => {
  try {
    const { status } = req.query;
    const where = status ? { status } : {};
    
    // Kiểm tra xem model có tồn tại không để tránh crash toàn diện
    if (!prisma.sOSAlert) {
       console.error('[SOS] Prisma model sOSAlert not found in client');
       return res.json({ success: true, data: [], warning: 'DATABASE_MIGRATION_REQUIRED' });
    }

    const alerts = await prisma.sOSAlert.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      include: {
        trip: {
          include: {
            customer: { include: { user: true } },
            driver: { include: { user: true } },
            vehicle: true
          }
        }
      }
    });

    res.json({ success: true, data: alerts });
  } catch (error) {
    console.error('[SOS] Error fetching alerts:', error);
    // Nếu lỗi là do thiếu bảng (P2021), trả về mảng rỗng thay vì 500
    if (error.code === 'P2021') {
      return res.json({ success: true, data: [], warning: 'DATABASE_MIGRATION_REQUIRED' });
    }
    res.status(500).json({ success: false, message: 'Lỗi khi lấy danh sách cảnh báo SOS' });
  }
};


export const resolveAlert = async (req, res) => {
  try {
    const { id } = req.params;
    const alertId = parseInt(id);

    const alert = await prisma.sOSAlert.update({
      where: { id: alertId },
      data: {
        status: 'resolved',
        resolvedAt: new Date()
      }
    });

    res.json({ success: true, message: 'Đã đánh dấu xử lý xong', data: alert });
  } catch (error) {
    console.error('[SOS] Error resolving alert:', error);
    res.status(500).json({ success: false, message: 'Lỗi khi xác nhận xử lý vụ việc' });
  }
};

export const getPendingCount = async (req, res) => {
  try {
    if (!prisma.sOSAlert) {
      return res.json({ success: true, count: 0 });
    }
    const count = await prisma.sOSAlert.count({
      where: { status: 'active' }
    });
    res.json({ success: true, count });
  } catch (error) {
    console.error('[SOS] Error counting alerts:', error);
    res.json({ success: true, count: 0 }); // Fallback to 0 instead of error
  }
};
