import * as authAdmin from '../services/admin.service.js';

export const loginController = async (req, res) => {
    try {
        const { email, password } = req.body;
        // Validate dữ liệu đầu vào
        if (!email || !password) {
            console.log('Thiếu dữ liệu đầu vào:', { email, password });
            return res.status(400).json({
                success: false,
                message: 'Vui lòng cung cấp đầy đủ: mail và password.',
            });
        }
        const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
        if (!emailRegex.test(email)) {
            return res.status(400).json({
                success: false,
                message: 'Địa chỉ email không đúng định dạng.',
            });
        }
        if (password.length < 8) {
            return res.status(400).json({
                success: false,
                message: 'Mật khẩu không hợp lệ.',
            });
        }
        
        // Nhận lấy object chứa user và JWT token
        const result = await authAdmin.loginUser({ email, password });
        
        return res.status(200).json({
            success: true,
            message: 'Đăng nhập thành công',
            data: result.user,
            token: result.token
        });
    }
    catch (error) {
        if (error.message === 'Email hoặc mật khẩu không chính xác.' || error.message === 'Bạn không có quyền hạn đăng nhập. Tính năng này chỉ dành cho Admin.') {
            console.log('Lỗi đăng nhập Admin:', error.message);
            return res.status(401).json({
                success: false,
                message: error.message,
            });
        }
        console.error('Lỗi login controller:', error);
        return res.status(500).json({
            success: false,
            message: 'Lỗi máy chủ nội bộ: ' + error.message,
        });
    }
};

export const logoutController = async (req, res) => {
    try {
        return res.status(200).json({
            success: true,
            message: 'Đăng xuất thành công. Vui lòng xoá token ở Client.'
        });
    } catch (error) {
        console.error('Lỗi logout controller:', error);
        return res.status(500).json({
            success: false,
            message: 'Lỗi máy chủ nội bộ'
        });
    }
};

export const getAllUsers = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const result = await authAdmin.getAllUsers(page, limit);
        return res.status(200).json({
            success: true,
            ...result
        });
    } catch (error) {
        console.error('Lỗi getAllUsers:', error);
        return res.status(500).json({ success: false, message: 'Lỗi máy chủ nội bộ' });
    }
};

export const getAllDrivers = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const result = await authAdmin.getAllDrivers(page, limit);
        return res.status(200).json({
            success: true,
            ...result
        });
    } catch (error) {
        console.error('Lỗi getAllDrivers:', error);
        return res.status(500).json({ success: false, message: 'Lỗi máy chủ nội bộ' });
    }
};

export const updateDriverStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const { status, reason, reviewedById } = req.body;
        const driver = await authAdmin.updateDriverStatus(id, status, reason, reviewedById);
        return res.status(200).json({
            success: true,
            message: 'Cập nhật trạng thái tài xế thành công',
            data: driver
        });
    } catch (error) {
        console.error('Lỗi updateDriverStatus:', error);
        return res.status(500).json({ success: false, message: 'Lỗi máy chủ nội bộ' });
    }
};

export const updateDocumentStatus = async (req, res) => {
    try {
        const { id } = req.params;
        const { status, reviewedById } = req.body;
        const doc = await authAdmin.updateDocumentStatus(id, status, reviewedById);
        return res.status(200).json({
            success: true,
            message: 'Cập nhật trạng thái tài liệu thành công',
            data: doc
        });
    } catch (error) {
        console.error('Lỗi updateDocumentStatus:', error);
        return res.status(500).json({ success: false, message: 'Lỗi máy chủ nội bộ' });
    }
};

export const lockDriver = async (req, res) => {
    try {
        const { id } = req.params;
        const { hours, reason } = req.body;
        const driver = await authAdmin.lockDriver(id, hours, reason);
        return res.status(200).json({
            success: true,
            message: `Tài xế đã bị khóa ${hours ? `trong ${hours} giờ` : 'vĩnh viễn'}`,
            data: driver
        });
    } catch (error) {
        console.error('Lỗi lockDriver:', error);
        return res.status(500).json({ success: false, message: 'Lỗi máy chủ nội bộ' });
    }
};

export const unlockDriver = async (req, res) => {
    try {
        const { id } = req.params;
        const driver = await authAdmin.unlockDriver(id);
        return res.status(200).json({
            success: true,
            message: 'Mở khóa tài xế thành công',
            data: driver
        });
    } catch (error) {
        console.error('Lỗi unlockDriver:', error);
        return res.status(500).json({ success: false, message: 'Lỗi máy chủ nội bộ' });
    }
};

export const createDriver = async (req, res) => {
    try {
        const result = await authAdmin.createDriverAdmin(req.body);
        return res.status(201).json({
            success: true,
            message: 'Tạo tài xế mới thành công',
            data: result
        });
    } catch (error) {
        if (error.code === 'P2002') {
            return res.status(400).json({
                success: false,
                message: 'Số điện thoại, Email, CCCD hoặc Số bằng lái đã tồn tại trên hệ thống.'
            });
        }
        console.error('Lỗi createDriver:', error);
        return res.status(500).json({ success: false, message: 'Lỗi máy chủ nội bộ' });
    }
};

export const getDriverStatsController = async (req, res) => {
    try {
        const stats = await authAdmin.getDriverStats();
        return res.status(200).json({
            success: true,
            data: stats
        });
    } catch (error) {
        console.error('Lỗi getDriverStatsController:', error);
        return res.status(500).json({ success: false, message: 'Lỗi máy chủ nội bộ' });
    }
};

export const getDriverRanksController = async (req, res) => {
    try {
        const ranks = await authAdmin.getDriverRanks();
        return res.status(200).json({
            success: true,
            data: ranks
        });
    } catch (error) {
        console.error('Lỗi getDriverRanksController:', error);
        return res.status(500).json({ success: false, message: 'Lỗi máy chủ nội bộ' });
    }
};

export const updateDriverRankController = async (req, res) => {
    try {
        const { id } = req.params;
        const rank = await authAdmin.updateDriverRank(id, req.body);
        return res.status(200).json({
            success: true,
            message: 'Cập nhật hạng tài xế thành công',
            data: rank
        });
    } catch (error) {
        console.error('Lỗi updateDriverRankController:', error);
        return res.status(500).json({ success: false, message: 'Lỗi máy chủ nội bộ' });
    }
};

export const createDriverRankController = async (req, res) => {
    try {
        const rank = await authAdmin.createDriverRank(req.body);
        return res.status(201).json({
            success: true,
            message: 'Tạo hạng tài xế mới thành công',
            data: rank
        });
    } catch (error) {
        console.error('Lỗi createDriverRankController:', error);
        return res.status(500).json({ success: false, message: 'Lỗi máy chủ nội bộ' });
    }
};

export const getSystemConfigController = async (req, res) => {
    try {
        const { key } = req.params;
        const config = await authAdmin.getSystemConfig(key);
        if (!config) {
            return res.status(404).json({ success: false, message: 'Không tìm thấy cấu hình' });
        }
        return res.status(200).json({
            success: true,
            data: config
        });
    } catch (error) {
        console.error('Lỗi getSystemConfigController:', error);
        return res.status(500).json({ success: false, message: 'Lỗi máy chủ nội bộ' });
    }
};

export const updateSystemConfigController = async (req, res) => {
    try {
        const { key } = req.params;
        const config = await authAdmin.updateSystemConfig(key, req.body);
        return res.status(200).json({
            success: true,
            message: 'Cập nhật cấu hình hệ thống thành công',
            data: config
        });
    } catch (error) {
        console.error('Lỗi updateSystemConfigController:', error);
        return res.status(500).json({ success: false, message: 'Lỗi máy chủ nội bộ' });
    }
};


export const getAllTrips = async (req, res) => {
    try {
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const result = await authAdmin.getAllTrips(page, limit);
        return res.status(200).json({
            success: true,
            ...result
        });
    } catch (error) {
        console.error('Lỗi getAllTrips:', error);
        return res.status(500).json({ success: false, message: 'Lỗi máy chủ nội bộ' });
    }
};

export const getTripDetail = async (req, res) => {
    try {
        const { id } = req.params;
        const trip = await authAdmin.getTripDetailAdmin(id);
        
        if (!trip) {
            return res.status(404).json({ success: false, message: 'Không tìm thấy chuyến đi' });
        }
        
        return res.status(200).json({
            success: true,
            data: trip
        });
    } catch (error) {
        console.error('Lỗi getTripDetail:', error);
        return res.status(500).json({ success: false, message: 'Lỗi máy chủ nội bộ' });
    }
};
