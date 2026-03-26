import { Router } from "express";
import * as adminController from '../controllers/admin.controler.js';
import * as adminCustomerController from '../controllers/admin.customer.controller.js';
import { verifyAdminToken } from '../middlewares/auth.middleware.js';

const router = Router();

// Route Đăng nhập (Mở - Public)
router.post('/login', adminController.loginController);

// Route Đăng xuất (Có áp dụng middleware xác thực token của Admin)
router.post('/logout', verifyAdminToken, adminController.logoutController);

// --- Quản lý người dùng tổng quát ---
router.get('/users', verifyAdminToken, adminController.getAllUsers);

// --- Quản lý khách hàng ---
router.get('/customers', verifyAdminToken, adminCustomerController.getCustomersInfo);
router.get('/customers/stats', verifyAdminToken, adminCustomerController.getCustomerStats);
router.get('/customers/:id', verifyAdminToken, adminCustomerController.getCustomerDetail);
router.put('/customers/:id/status', verifyAdminToken, adminCustomerController.updateCustomerStatus);
// Quản lý tài xế
router.get('/drivers', adminController.getAllDrivers);
router.put('/drivers/:id/status', adminController.updateDriverStatus);
router.put('/documents/:id/status', adminController.updateDocumentStatus);
router.put('/drivers/:id/lock', adminController.lockDriver);
router.put('/drivers/:id/unlock', adminController.unlockDriver);
router.post('/drivers', adminController.createDriver);

// --- Thống kê ---
router.get('/stats/drivers', verifyAdminToken, adminController.getDriverStatsController);

// --- Quản lý hạng tài xế ---
router.get('/driver-ranks', verifyAdminToken, adminController.getDriverRanksController);
router.post('/driver-ranks', verifyAdminToken, adminController.createDriverRankController);
router.put('/driver-ranks/:id', verifyAdminToken, adminController.updateDriverRankController);

// --- Cấu hình hệ thống ---
router.get('/system/configs/:key', verifyAdminToken, adminController.getSystemConfigController);
router.put('/system/configs/:key', verifyAdminToken, adminController.updateSystemConfigController);

export default router;

