import express from 'express';
import multer from 'multer';
import * as vehicleController from '../controllers/vehicle.controller.js';

const router = express.Router();

// Cấu hình Multer để lưu tạm file vào bộ nhớ trước khi tải lên Supabase
const storage = multer.memoryStorage();
const upload = multer({ 
  storage,
  limits: { fileSize: 5 * 1024 * 1024 } // Giới hạn 5MB mỗi ảnh
});

/**
 * @route POST /api/vehicles/register
 * @desc Đăng ký phương tiện mới cho tài xế (Nhận nhiều ảnh)
 */
router.post('/register', upload.array('vehicle_images', 5), vehicleController.registerVehicle);

/**
 * @route PATCH /api/vehicles/:id/status
 * @desc Admin duyệt hoặc từ chối phương tiện
 */
router.patch('/:id/status', vehicleController.updateVehicleStatus);

export default router;
