import * as adminCustomerService from '../services/admin.customer.service.js';

export const getCustomersInfo = async (req, res) => {
    try {
        const { page = 1, limit = 10, search = '' } = req.query;
        const result = await adminCustomerService.getAllCustomers(page, limit, search);
        res.status(200).json({
            success: true,
            data: result,
        });
    } catch (error) {
        console.error('Error getting customers: ', error);
        res.status(500).json({
            success: false,
            message: 'Đã xảy ra lỗi khi lấy danh sách khách hàng.',
        });
    }
};

export const getCustomerDetail = async (req, res) => {
    try {
        const { id } = req.params;
        const result = await adminCustomerService.getCustomerDetail(id);
        res.status(200).json({
            success: true,
            data: result,
        });
    } catch (error) {
        console.error('Error getting customer detail: ', error);
        res.status(404).json({
            success: false,
            message: error.message || 'Không tìm thấy thông tin khách hàng.',
        });
    }
};

export const updateCustomerStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const { status } = req.body;
        
        if (!status) {
            return res.status(400).json({
                success: false,
                message: 'Vui lòng cung cấp status mới.',
            });
        }

        const result = await adminCustomerService.changeCustomerStatus(id, status);
        res.status(200).json({
            success: true,
            message: 'Cập nhật trạng thái thành công.',
            data: { id: result.id, status: result.status },
        });
    } catch (error) {
        console.error('Error updating customer status: ', error);
        res.status(400).json({
            success: false,
            message: error.message || 'Đã xảy ra lỗi khi cập nhật trạng thái.',
        });
    }
};

export const getCustomerStats = async (req, res) => {
    try {
        const stats = await adminCustomerService.getCustomerStats();
        res.status(200).json({
            success: true,
            data: stats,
        });
    } catch (error) {
        console.error('Error getting customer stats: ', error);
        res.status(500).json({
            success: false,
            message: '�� x?y ra l?i khi l?y th?ng k� kh�ch h�ng.',
        });
    }
};


export const getCustomerTrips = async (req, res) => {
    try {
        const { id } = req.params;
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 5;
        const result = await adminCustomerService.getCustomerTrips(id, page, limit);
        res.status(200).json({
            success: true,
            ...result,
        });
    } catch (error) {
        console.error('Error getting customer trips: ', error);
        res.status(500).json({
            success: false,
            message: 'Da xay ra loi khi lay lich su chuyen di.',
        });
    }
};
