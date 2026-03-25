import * as paymentService from '../services/payment.service.js';

export const handleSepayWebhook = async (req, res) => {
  try {
    console.log('[PAYMENT WEBHOOK] Received data:', req.body);

    // 1. Kiểm tra xác thực (Tạm thời bỏ qua để test cho nhanh)
    /*
    const webhookKey = req.headers['x-api-key'] || req.query.key;
    if (webhookKey !== process.env.SEPAY_WEBHOOK_KEY) {
      console.warn('[PAYMENT WEBHOOK] Unauthorized request. Provided key:', webhookKey);
      return res.status(401).json({ success: false, message: 'Unauthorized' });
    }
    */

    const result = await paymentService.processSepayWebhook(req.body);

    if (result.success) {
      console.log('[PAYMENT WEBHOOK] Successfully processed:', result.message || 'Success');
      return res.status(200).json({ success: true, message: result.message });
    } else {
      console.warn('[PAYMENT WEBHOOK] Semi-failed:', result.message);
      // Vẫn trả về 200 để Sepay không gửi đi gửi lại nếu lỗi là do input sai (không tìm thấy user)
      return res.status(200).json({ success: false, message: result.message });
    }
  } catch (error) {
    console.error('[PAYMENT WEBHOOK] Error:', error);
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
    console.error('[GET PAYMENT INFO] Error:', error);
    res.status(500).json({ success: false, message: 'Internal Server Error' });
  }
};
