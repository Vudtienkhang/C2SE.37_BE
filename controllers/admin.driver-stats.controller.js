import * as driverStatsService from '../services/admin.driver-stats.service.js';

/**
 * Controller lấy thống kê doanh thu và số chuyến của tài xế
 */
export const getDriverRevenueStats = async (req, res) => {
    try {
        const { id } = req.params;
        const { period } = req.query; // week, month, year

        if (!id) {
            return res.status(400).json({
                success: false,
                message: 'Thiếu Driver ID'
            });
        }

        const stats = await driverStatsService.getDriverRevenueStats(id, period || 'week');

        return res.status(200).json({
            success: true,
            message: 'Lấy thống kê doanh thu tài xế thành công',
            data: stats
        });
    } catch (error) {
        console.error('Lỗi getDriverRevenueStats controller:', error);
        return res.status(500).json({
            success: false,
            message: error.message || 'Lỗi khi tính toán thống kê tài xế'
        });
    }
};
