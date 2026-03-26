import express from 'express';
import * as driverController from '../controllers/driver.controller.js';
import { verifyToken } from '../middlewares/auth.middleware.js';

const router = express.Router();

// Lấy thông tin thu nhập (tài xế đã login)
router.get('/earnings', verifyToken, driverController.getEarnings);

export default router;
