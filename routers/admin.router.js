import { Router } from "express";
import multer from 'multer';
import * as adminController from '../controllers/admin.controler.js';
import * as adminCustomerController from '../controllers/admin.customer.controller.js';
import * as adminStatsController from '../controllers/admin.stats.controller.js';
import * as adminDriverStatsController from '../controllers/admin.driver-stats.controller.js';
import * as adminRevenueController from '../controllers/admin.revenue.controller.js';
import * as adminRoleController from '../controllers/admin.role.controller.js';
import * as reviewController from '../controllers/review.controller.js';
import { verifyAdminToken, checkPermission } from '../middlewares/auth.middleware.js';

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

// Route Đăng nhập (Mở - Public)
router.post('/login', adminController.loginController);

// Route Đăng xuất (Có áp dụng middleware xác thực token của Admin)
router.post('/logout', verifyAdminToken, adminController.logoutController);

// --- Quản lý Phân quyền (RBAC) ---
router.get('/my-permissions', verifyAdminToken, adminRoleController.getMyPermissions);
router.get('/permissions', verifyAdminToken, checkPermission('ROLES_MANAGE'), adminRoleController.getPermissions);
router.get('/roles', verifyAdminToken, checkPermission('ROLES_MANAGE'), adminRoleController.getRoles);
router.post('/roles', verifyAdminToken, checkPermission('ROLES_MANAGE'), adminRoleController.createRole);
router.put('/roles/:id/permissions', verifyAdminToken, checkPermission('ROLES_MANAGE'), adminRoleController.updateRolePermissions);
router.get('/roles/:id/users', verifyAdminToken, checkPermission('ROLES_MANAGE'), adminRoleController.getUsersInRole);
router.post('/staff', verifyAdminToken, checkPermission('ROLES_MANAGE'), adminRoleController.createStaff);
router.patch('/staff/:id/status', verifyAdminToken, checkPermission('STAFF_STATUS_MANAGE'), adminRoleController.updateStaffStatus);

// Excel Import Staff
router.get('/staff/template', verifyAdminToken, checkPermission('ROLES_MANAGE'), adminRoleController.downloadTemplate);
router.post('/staff/import', verifyAdminToken, checkPermission('ROLES_MANAGE'), upload.single('file'), adminRoleController.importStaff);

// --- Quản lý người dùng tổng quát ---
router.get('/users', verifyAdminToken, checkPermission('ROLES_MANAGE'), adminController.getAllUsers);

// --- Quản lý khách hàng ---
router.get('/customers', verifyAdminToken, checkPermission('CUSTOMERS_VIEW'), adminCustomerController.getCustomersInfo);
router.get('/customers/stats', verifyAdminToken, checkPermission('DASHBOARD_VIEW'), adminCustomerController.getCustomerStats);
router.get('/customers/:id', verifyAdminToken, checkPermission('CUSTOMERS_VIEW'), adminCustomerController.getCustomerDetail);
router.get('/customers/:id/trips', verifyAdminToken, checkPermission('CUSTOMERS_VIEW'), adminCustomerController.getCustomerTrips);
router.put('/customers/:id/status', verifyAdminToken, checkPermission('CUSTOMERS_STATUS_EDIT'), adminCustomerController.updateCustomerStatus);

// Quản lý tài xế
router.get('/drivers', verifyAdminToken, checkPermission('DRIVERS_VIEW'), adminController.getAllDrivers);
router.put('/drivers/:id/status', verifyAdminToken, checkPermission('DRIVERS_STATUS_EDIT'), adminController.updateDriverStatus);
router.put('/documents/:id/status', verifyAdminToken, checkPermission('DRIVERS_STATUS_EDIT'), adminController.updateDocumentStatus);
router.put('/drivers/:id/lock', verifyAdminToken, checkPermission('DRIVERS_STATUS_EDIT'), adminController.lockDriver);
router.put('/drivers/:id/unlock', verifyAdminToken, checkPermission('DRIVERS_STATUS_EDIT'), adminController.unlockDriver);
router.get('/drivers/:id/revenue-stats', verifyAdminToken, checkPermission('DRIVERS_STATS_VIEW'), adminDriverStatsController.getDriverRevenueStats);
router.post('/drivers', verifyAdminToken, checkPermission('DRIVERS_STATUS_EDIT'), adminController.createDriver);


// --- Thống kê ---
router.get('/stats/drivers', verifyAdminToken, checkPermission('DRIVERS_STATS_VIEW'), adminController.getDriverStatsController);
router.get('/stats/comprehensive', verifyAdminToken, checkPermission('DASHBOARD_VIEW'), adminStatsController.getComprehensiveStatsController);
router.get('/revenue/stats', verifyAdminToken, checkPermission('REVENUE_VIEW'), adminRevenueController.getRevenueStats);
router.get('/revenue/transactions', verifyAdminToken, checkPermission('REVENUE_VIEW'), adminRevenueController.getRecentTransactions);

// --- Quản lý chuyến đi ---
router.get('/trips', verifyAdminToken, checkPermission('TRIPS_VIEW'), adminController.getAllTrips);
router.get('/trips/:id', verifyAdminToken, checkPermission('TRIPS_VIEW'), adminController.getTripDetail);

// --- Quản lý đánh giá ---
router.get('/reviews', verifyAdminToken, checkPermission('TRIPS_VIEW'), reviewController.getReviews);

// --- Quản lý hạng tài xế ---
router.get('/driver-ranks', verifyAdminToken, checkPermission('DRIVERS_RANKS_MANAGE'), adminController.getDriverRanksController);
router.post('/driver-ranks', verifyAdminToken, checkPermission('DRIVERS_RANKS_MANAGE'), adminController.createDriverRankController);
router.put('/driver-ranks/:id', verifyAdminToken, checkPermission('DRIVERS_RANKS_MANAGE'), adminController.updateDriverRankController);

// --- Cấu hình hệ thống ---
router.get('/system/configs/:key', verifyAdminToken, checkPermission('SYSTEM_CONFIG_MANAGE'), adminController.getSystemConfigController);
router.put('/system/configs/:key', verifyAdminToken, checkPermission('SYSTEM_CONFIG_MANAGE'), adminController.updateSystemConfigController);

export default router;

