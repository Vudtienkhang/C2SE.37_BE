import { Router } from "express";
import * as adminController from '../controllers/admin.controler.js';
import * as adminCustomerController from '../controllers/admin.customer.controller.js';
import * as systemConfigController from '../controllers/systemConfig.controller.js';
import { verifyAdminToken } from '../middlewares/auth.middleware.js';

const router = Router();

// Route Đăng nhập (Mở - Public)
router.post('/login', adminController.loginController);

// Route Đăng xuất (Có áp dụng middleware xác thực token của Admin)
router.post('/logout', verifyAdminToken, adminController.logoutController);

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

// Quản lý Driver Rank
router.get('/driver-ranks', verifyAdminToken, adminController.getDriverRanks);
router.put('/driver-ranks/:id', verifyAdminToken, adminController.updateDriverRank);

// Quản lý Stats
router.get('/stats/drivers', verifyAdminToken, adminController.getDriverStats);

// Quản lý System Config
router.get('/system/configs/:key', verifyAdminToken, systemConfigController.getSystemConfig);
router.put('/system/configs/:key', verifyAdminToken, systemConfigController.updateSystemConfig);

export default router;
