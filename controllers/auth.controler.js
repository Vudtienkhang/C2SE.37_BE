import * as authService from '../services/auth.services.js';

export const register = async (req, res) => {
  try {
    const { fullName, phone, password, roleId } = req.body;

    // Validate dữ liệu đầu vào
    if (!fullName || !phone || !password) {
      console.log('Thiếu dữ liệu đầu vào:', { fullName, phone, password });
      return res.status(400).json({
        success: false,
        message: 'Vui lòng cung cấp đầy đủ: fullName, phone, và password.',
      });
    }

    // Gọi đến tầng service để xử lý logic
    const user = await authService.registerUser({
      fullName,
      phone,
      password,
      roleId: roleId ? parseInt(roleId) : 1,
    });

    // Trả về response thành công (không trả về password)
    return res.status(201).json({
      success: true,
      message: 'Đăng ký tài khoản thành công',
      data: {
        id: user.id,
        fullName: user.fullName,
        phone: user.phone,
        roleId: user.roleId,
      },
    });
  } catch (error) {
    // Xử lý lỗi từ service ném ra (ví dụ trùng sđt)
    if (error.message === 'Số điện thoại đã được sử dụng.') {
      console.log('Lỗi đăng ký:', error.message);
      return res.status(409).json({
        success: false,
        message: error.message,
      });
    }

    console.error('Lỗi register controller:', error);
    return res.status(500).json({
      success: false,
      message: 'Lỗi máy chủ nội bộ',
    });
  }
};
