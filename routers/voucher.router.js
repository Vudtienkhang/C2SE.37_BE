import express from 'express';
import * as controller from '../controllers/voucher.controller.js';
import { verifyAdminToken } from '../middlewares/auth.middleware.js';

const router = express.Router();

router.post('/validate', controller.validateVoucher);
router.get('/public', controller.getPublicVouchers);

router.use(verifyAdminToken);

router.get('/', controller.getAllVouchers);
router.get('/:id', controller.getVoucherById);
router.post('/', controller.createVoucher);
router.put('/:id', controller.updateVoucher);
router.patch('/:id/toggle', controller.toggleVoucherStatus);
router.delete('/:id', controller.deleteVoucher);

export default router;
