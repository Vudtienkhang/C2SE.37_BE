import logger from '../lib/logger.js';
import * as paymentService from '../services/payment.service.js';

export const handleSepayWebhook = async (req, res) => {
  try {
    logger.info({ body: req.body }, '[PAYMENT WEBHOOK] Received data');

    // 1. Kiểm tra xác thực (Tạm thời bỏ qua để test cho nhanh)
    /*
    const webhookKey = req.headers['x-api-key'] || req.query.key;
    if (webhookKey !== process.env.SEPAY_WEBHOOK_KEY) {
      logger.warn({ webhookKey }, '[PAYMENT WEBHOOK] Unauthorized request');
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    */

    const result = await paymentService.processSepayWebhook(req.body);

    if (result.success) {
      logger.info({ message: result.message }, '[PAYMENT WEBHOOK] Successfully processed');
      return res.status(200).json({ success: true, message: result.message });
    } else {
      logger.warn({ message: result.message }, '[PAYMENT WEBHOOK] Semi-failed');
      // Vẫn trả về 200 để Sepay không gửi đi gửi lại nếu lỗi là do input sai (không tìm thấy user)
      return res.status(200).json({ success: false, message: result.message });
    }
  } catch (error) {
    logger.error(error, '[PAYMENT WEBHOOK] Error');
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};

export const getPaymentInfo = async (req, res) => {
  try {
    const { userId } = req.query; // Hoặc từ token auth (req.user.id)
    const { amount } = req.query;

    if (!userId) {
      return res.status(400).json({ success: false, message: 'Missing userId' });
    }

    const info = await paymentService.createPaymentRequest(userId, amount || 0);
    return res.status(200).json(info);
  } catch (error) {
    logger.error(error, '[GET PAYMENT INFO] Error');
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};
