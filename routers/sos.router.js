import express from 'express';
import * as sosController from '../controllers/sos.controller.js';
import { verifyAdminToken, checkPermission } from '../middlewares/auth.middleware.js';

const router = express.Router();

router.get('/', verifyAdminToken, checkPermission('SOS_MANAGE'), sosController.getAllAlerts);
router.patch('/:id/resolve', verifyAdminToken, checkPermission('SOS_MANAGE'), sosController.resolveAlert);

export default router;
