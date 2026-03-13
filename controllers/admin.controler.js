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
            message: 'Lỗi máy chủ nội bộ',
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
