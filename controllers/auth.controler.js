import * as authService from '../services/auth.services.js';

export const register = async (req, res) => {
  try {
    const { fullName, phone, password, roleId } = req.body;
    console.log('Dữ liệu đăng ký nhận được:', { fullName, phone, password, roleId });
    // Validate dữ liệu đầu vào
    if (!fullName || !phone || !password) {
      console.log('Lỗi: Thiếu dữ liệu đầu vào:', { fullName, phone, password });
      return res.status(400).json({
        success: false,
        message: 'Vui lòng cung cấp đầy đủ: fullName, phone, và password.',
      });
    }

    const phoneRegex = /^(0|84)(3|5|7|8|9)[0-9]{8}$/;
    if (!phoneRegex.test(phone)) {
      return res.status(400).json({
        success: false,
        message: 'Số điện thoại không hợp lệ. Vui lòng nhập số điện thoại chuẩn Việt Nam.',
      });
    }

    if (password.length < 8) {
      return res.status(400).json({
        success: false,
        message: 'Mật khẩu phải có ít nhất 8 ký tự.',
      });
    }

    // Gọi đến tầng service để xử lý logic
    const user = await authService.registerUser({
      fullName,
      phone,
      password,
      roleId: roleId ? parseInt(roleId) : 3,
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

export const login = async (req, res) => {
  try {
    const { phone, password } = req.body;

    // Validate dữ liệu đầu vào
    if (!phone || !password) {
      console.log('Thiếu dữ liệu đầu vào:', { phone, password });
      return res.status(400).json({
        success: false,
        message: 'Vui lòng cung cấp đầy đủ: phone và password.',
      });
    }

    const phoneRegex = /^(0|84)(3|5|7|8|9)[0-9]{8}$/;
    if (!phoneRegex.test(phone)) {
      return res.status(400).json({
        success: false,
        message: 'Số điện thoại không hợp lệ.',
      });
    }

    if (password.length < 8) {
      return res.status(400).json({
        success: false,
        message: 'Mật khẩu không hợp lệ.',
      });
    }

    // Gọi đến tầng service để xử lý logic
    const { user, token } = await authService.loginUser({ phone, password });

    // Trả về response thành công (không trả về password)
    return res.status(200).json({
      success: true,
      message: 'Đăng nhập thành công',
      data: {
        id: user.id,
        fullName: user.fullName,
        phone: user.phone,
        roleId: user.roleId,
        token: token,
      },
    });
  } catch (error) {
    if (error.message === 'Số điện thoại hoặc mật khẩu không chính xác.') {
      console.log('Lỗi đăng nhập:', error.message);
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

export const getUserProfile = async (req, res) => {
  try {
    const { id } = req.params;
    console.log("id người dùng: ", id)
    if (!id) {
      return res.status(400).json({
        success: false,
        message: 'Vui lòng cung cấp id người dùng.',
      });
    }

    const user = await authService.getUserById(id);

    return res.status(200).json({
      success: true,
      message: 'Lấy thông tin tài khoản thành công',
      data: user,
    });
  } catch (error) {
    console.error('[PROFILE_ERROR]', error);
    return res.status(error.message === 'Người dùng không tồn tại.' || error.message === 'ID người dùng không hợp lệ.' ? 404 : 500).json({
      success: false,
      message: error.message || 'Lỗi lấy thông tin cá nhân',
    });
  }
  }


export const updateProfile = async (req, res) => {
  try {
    const { id } = req.params;
    const { fullName, phone, email } = req.body;

    if (!id) {
      return res.status(400).json({
        success: false,
        message: 'Vui lòng cung cấp id người dùng.',
      });
    }

    // Validate email format if provided
    if (email) {
      const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
      if (!emailRegex.test(email)) {
        return res.status(400).json({
          success: false,
          message: 'Địa chỉ email không đúng định dạng.',
        });
      }
    }

    // Validate phone format if provided
    if (phone) {
      const phoneRegex = /^(0|84)(3|5|7|8|9)[0-9]{8}$/;
      if (!phoneRegex.test(phone)) {
        return res.status(400).json({
          success: false,
          message: 'Số điện thoại không hợp lệ.',
        });
      }
    }

    const updatedUser = await authService.updateUser(id, { fullName, phone, email });

    return res.status(200).json({
      success: true,
      message: 'Cập nhật thông tin tài khoản thành công',
      data: updatedUser,
    });
  } catch (error) {
    if (error.message === 'Người dùng không tồn tại.') {
      return res.status(404).json({
        success: false,
        message: error.message,
      });
    }

    if (error.message === 'Số điện thoại đã được sử dụng.' || error.message === 'Email đã được sử dụng.') {
      return res.status(409).json({
        success: false,
        message: error.message,
      });
    }

    console.error('Lỗi updateProfile controller:', error);
    return res.status(500).json({
      success: false,
      message: 'Lỗi máy chủ nội bộ',
    });
  }
};

export const registerDriver = async (req, res) => {
  try {
    const { userId, fullName, cccdNumber, licenseNumber, licenseType, avatarUrl, serviceType } = req.body;

    if (!userId || !cccdNumber || !licenseNumber) {
      return res.status(400).json({
        success: false,
        message: 'Vui lòng cung cấp đầy đủ: userId, cccdNumber và licenseNumber.',
      });
    }

    const driver = await authService.registerDriver({
      userId,
      fullName,
      cccdNumber,
      licenseNumber,
      licenseType,
      avatarUrl,
      serviceType
    });

    return res.status(200).json({
      success: true,
      message: 'Đăng ký thông tin tài xế thành công. Vui lòng tải lên tài liệu để hoàn tất.',
      data: driver,
    });
  } catch (error) {
    console.error('Lỗi registerDriver controller:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Lỗi máy chủ nội bộ',
    });
  }
};


