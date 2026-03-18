import { Router } from "express";
import * as adminController from '../controllers/admin.controler.js';
import { verifyAdminToken } from '../middlewares/auth.middleware.js';

const router = Router();

// Route Đăng nhập (Mở - Public)
router.post('/login', adminController.loginController);

// Route Đăng xuất (Có áp dụng middleware xác thực token của Admin)
router.post('/logout', verifyAdminToken, adminController.logoutController);

// Quản lý tài xế
router.get('/drivers', adminController.getAllDrivers);
router.put('/drivers/:id/status', adminController.updateDriverStatus);
router.put('/documents/:id/status', adminController.updateDocumentStatus);
router.put('/drivers/:id/lock', adminController.lockDriver);
router.put('/drivers/:id/unlock', adminController.unlockDriver);
router.post('/drivers', adminController.createDriver);

export default router;
