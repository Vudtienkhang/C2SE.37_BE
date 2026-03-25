import express from 'express';
import * as paymentController from '../controllers/payment.controller.js';

const router = express.Router();

// Webhook từ Sepay
router.post('/sepay-webhook', paymentController.handleSepayWebhook);
router.get('/sepay-webhook', (req, res) => res.send('Webhook endpoint is ALIVE! (GET method)'));

// Lấy thông tin nạp tiền (QR Code)
router.get('/get-info', paymentController.getPaymentInfo);

export default router;
