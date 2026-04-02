import express from 'express';
import * as controller from '../controllers/voucher.controller.js';
import { verifyAdminToken, verifyToken, optionalVerifyToken } from '../middlewares/auth.middleware.js';

const router = express.Router();

router.post('/validate', verifyToken, controller.validateVoucher);
router.get('/public', optionalVerifyToken, controller.getPublicVouchers);

router.use(verifyAdminToken);

router.get('/', controller.getAllVouchers);
router.get('/:id', controller.getVoucherById);
router.post('/', controller.createVoucher);
router.put('/:id', controller.updateVoucher);
router.patch('/:id/toggle', controller.toggleVoucherStatus);
router.delete('/:id', controller.deleteVoucher);

export default router;
