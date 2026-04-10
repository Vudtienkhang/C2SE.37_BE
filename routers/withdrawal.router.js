import { Router } from 'express';
import * as withdrawalController from '../controllers/withdrawal.controller.js';
import { verifyAdminToken, checkPermission } from '../middlewares/auth.middleware.js';

const router = Router();

// Route cho người dùng (Thường cần thêm middleware xác thực/auth)
router.post('/', withdrawalController.createWithdrawalRequest);
router.get('/user/:userId', withdrawalController.getUserWithdrawals);

// Route cho admin
router.get('/all', verifyAdminToken, checkPermission('WITHDRAWALS_VIEW'), withdrawalController.getAllWithdrawals);
router.get('/pending-count', verifyAdminToken, checkPermission('WITHDRAWALS_VIEW'), withdrawalController.getPendingCount);
router.patch('/:id/status', verifyAdminToken, checkPermission('WITHDRAWALS_APPROVE'), withdrawalController.updateWithdrawalStatus);

export default router;
