import prisma from "../prisma/prisma.js";
import * as uploadService from "../services/upload.service.js";

/**
 * Đăng ký phương tiện cho tài xế
 */
export const registerVehicle = async (req, res) => {
  try {
    const { userId, plateNumber, brand, model, type } = req.body;
    const files = req.files; // Mảng các file ảnh từ multer

    if (!userId || !plateNumber || !type) {
      return res.status(400).json({ success: false, message: 'Thiếu thông tin người dùng, biển số hoặc loại xe.' });
    }

    // 1. Tìm tài xế dựa trên userId
    const numericUserId = parseInt(userId, 10);
    if (isNaN(numericUserId)) {
      return res.status(400).json({ success: false, message: 'ID người dùng không hợp lệ.' });
    }

    const driver = await prisma.driver.findUnique({
      where: { userId: numericUserId }
    });

    if (!driver) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy thông tin hồ sơ tài xế.' });
    }

    // 2. Kiểm tra biển số xe đã tồn tại chưa
    const existingVehicle = await prisma.driverVehicle.findUnique({
      where: { plateNumber }
    });

    if (existingVehicle) {
      return res.status(400).json({ success: false, message: 'Biển số xe này đã được đăng ký trên hệ thống.' });
    }

    // 3. Upload ảnh lên Supabase
    let imageUrls = [];
    if (files && files.length > 0) {
      imageUrls = await uploadService.uploadVehicleImagesToSupabase(driver.id, files);
    }

    // 4. Lưu vào Database
    const vehicle = await prisma.driverVehicle.create({
      data: {
        driverId: driver.id,
        plateNumber,
        brand,
        model,
        type, // 'bike', 'car_4', 'car_7'
        images: imageUrls,
        status: 'pending' // Chờ duyệt
      }
    });

    return res.status(200).json({
      success: true,
      message: 'Gửi yêu cầu đăng ký phương tiện thành công. Vui lòng chờ Admin phê duyệt.',
      data: vehicle
    });

  } catch (error) {
    console.error('Lỗi registerVehicle controller:', error);
    return res.status(500).json({
      success: false,
      message: error.message || 'Lỗi máy chủ nội bộ',
    });
  }
};

/**
 * Admin cập nhật trạng thái phương tiện (Duyệt/Từ chối)
 */
export const updateVehicleStatus = async (req, res) => {
  try {
    const { id } = req.params; // vehicleId
    const { status } = req.body; // 'approved', 'rejected'

    if (!['approved', 'rejected', 'pending'].includes(status)) {
      return res.status(400).json({ success: false, message: 'Trạng thái không hợp lệ.' });
    }

    const vehicle = await prisma.driverVehicle.update({
      where: { id: parseInt(id) },
      data: { status },
      include: {
        driver: {
            include: { user: true }
        }
      }
    });

    return res.status(200).json({
      success: true,
      message: `Đã ${status === 'approved' ? 'phê duyệt' : 'từ chối'} phương tiện thành công.`,
      data: vehicle
    });

  } catch (error) {
    console.error('Lỗi updateVehicleStatus controller:', error);
    return res.status(500).json({ success: false, message: 'Lỗi máy chủ nội bộ' });
  }
};
