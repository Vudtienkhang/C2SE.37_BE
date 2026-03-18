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
