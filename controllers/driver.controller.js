import * as driverService from '../services/driver.service.js';
import * as driverScoreService from '../services/driver-score.service.js';

/**
 * Controller lấy thông tin thu nhập của tài xế
 */
export const getEarnings = async (req, res) => {
  try {
    const userId = req.user.id;
    const { startDate, endDate } = req.query;
    const stats = await driverService.getDriverEarningsStats(userId, startDate, endDate);
    res.json(stats);
  } catch (error) {
    console.error('[DRIVER CONTROLLER] Error fetching earnings:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message || 'Lỗi hệ thống khi lấy thông tin thu nhập' 
    });
  }
};

/**
 * Lấy lịch sử điểm thưởng/phạt
 */
export const getPointHistory = async (req, res) => {
  try {
    const userId = req.user.id;
    const logs = await driverScoreService.getPointLogs(userId);
    res.json({ success: true, data: logs });
  } catch (error) {
    console.error('[DRIVER CONTROLLER] Error fetching point history:', error);
    res.status(500).json({ 
      success: false, 
      message: error.message || 'Lỗi hệ thống khi lấy lịch sử điểm' 
    });
  }
};
