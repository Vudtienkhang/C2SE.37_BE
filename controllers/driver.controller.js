import * as driverService from '../services/driver.service.js';

/**
 * Controller lấy thông tin thu nhập của tài xế
 */
export const getEarnings = async (req, res) => {
  try {
    const userId = req.user.id;
    const stats = await driverService.getDriverEarningsStats(userId);
    res.json(stats);
  } catch (error) {
    console.error('[DRIVER CONTROLLER] Error fetching earnings:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message || 'Lỗi hệ thống khi lấy thông tin thu nhập' 
    });
  }
};
