import { Router } from 'express';
import * as withdrawalController from '../controllers/withdrawal.controller.js';

const router = Router();

// Route cho người dùng (Thường cần thêm middleware xác thực/auth)
router.post('/', withdrawalController.createWithdrawalRequest);
router.get('/user/:userId', withdrawalController.getUserWithdrawals);

// Route cho admin (xác thực admin cần được thực hiện qua middleware)
router.get('/all', withdrawalController.getAllWithdrawals);
router.get('/pending-count', withdrawalController.getPendingCount);
router.patch('/:id/status', withdrawalController.updateWithdrawalStatus);

export default router;
