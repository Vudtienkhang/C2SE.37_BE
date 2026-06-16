import express from 'express';
import { verifyToken, verifyAdminToken, checkPermission } from '../middlewares/auth.middleware.js';
import academyController from '../controllers/academy.controller.js';

const router = express.Router();

// Public / Driver Routes
router.use(verifyToken);
router.get('/status', academyController.getAcademyStatus);
router.post('/learning/:moduleId', academyController.startLearning);
router.get('/certificate', academyController.downloadCertificate);

// Admin Routes
router.get('/admin/modules', verifyAdminToken, checkPermission('SYSTEM_CONFIG_MANAGE'), academyController.getModules);
router.post('/admin/modules', verifyAdminToken, checkPermission('SYSTEM_CONFIG_MANAGE'), academyController.createModule);
router.put('/admin/modules/:id', verifyAdminToken, checkPermission('SYSTEM_CONFIG_MANAGE'), academyController.updateModule);
router.delete('/admin/modules/:id', verifyAdminToken, checkPermission('SYSTEM_CONFIG_MANAGE'), academyController.deleteModule);
router.post('/admin/modules/:moduleId/contents', verifyAdminToken, checkPermission('SYSTEM_CONFIG_MANAGE'), academyController.addContent);
router.delete('/admin/contents/:id', verifyAdminToken, checkPermission('SYSTEM_CONFIG_MANAGE'), academyController.deleteContent);

export default router;
