import * as revenueService from '../services/admin.revenue.service.js';

export const getRevenueStats = async (req, res) => {
    try {
        const data = await revenueService.getRevenueStats();
        return res.status(200).json({
            success: true,
            data
        });
    } catch (error) {
        console.error('Lỗi getRevenueStats:', error);
        return res.status(500).json({
            success: false,
            message: 'Lỗi khi tải thống kê doanh thu'
        });
    }
};

export const getRecentTransactions = async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 10;
        const data = await revenueService.getRecentTransactions(limit);
        return res.status(200).json({
            success: true,
            data
        });
    } catch (error) {
        console.error('Lỗi getRecentTransactions:', error);
        return res.status(500).json({
            success: false,
            message: 'Lỗi khi tải lịch sử giao dịch'
        });
    }
};
