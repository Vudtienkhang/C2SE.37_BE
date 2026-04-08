import * as adminStatsService from '../services/admin.stats.service.js';

/**
 * Controller trả về dữ liệu thống kê tổng hợp hệ thống cho Admin Dashboard
 */
export const getComprehensiveStatsController = async (req, res) => {
    try {
        const stats = await adminStatsService.getComprehensiveStats();
        
        return res.status(200).json({
            success: true,
            message: 'Lấy thống kê hệ thống thành công',
            data: stats
        });
    } catch (error) {
        console.error('Lỗi getComprehensiveStatsController:', error);
        return res.status(500).json({
            success: false,
            message: error.message || 'Lỗi khi tính toán thống kê hệ thống',
        });
    }
};
