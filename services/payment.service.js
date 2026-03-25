import prisma from '../prisma/prisma.js';
import { getIO } from './socket.service.js';

/**
 * Xử lý nạp tiền từ Webhook của Sepay
 * @param {Object} data - Dữ liệu từ Sepay webhook
 */
export const processSepayWebhook = async (data) => {
  const {
    id: gatewayTransactionId, // ID giao dịch bên Sepay
    content,                 // Nội dung chuyển khoản (VD: "SW7")
    transferAmount: amount, // Số tiền
    transferType,           // Loại giao dịch (In/Out)
  } = data;

  console.log(`[PAYMENT SERVICE] Processing Tx: ${gatewayTransactionId}, Content: "${content}", Amount: ${amount}`);

  // 1. Chỉ xử lý giao dịch tiền vào (in) - Case insensitive
  if (transferType && transferType.toLowerCase() !== 'in') {
    return { success: false, message: 'Not a credit transaction' };
  }

  // 2. Parse UserID từ nội dung chuyển khoản
  // Tìm ID sau chuỗi "SW" hoặc "sw"
  const match = content.match(/SW(\d+)/i);
  if (!match) {
    console.warn('[PAYMENT SERVICE] Could not find SW<ID> in content:', content);
    return { success: false, message: 'Invalid transfer content, user ID not found' };
  }

  const userId = parseInt(match[1]);
  console.log(`[PAYMENT SERVICE] Parsed User ID: ${userId}`);

  // 3. Kiểm tra User tồn tại
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: { wallet: true }
  });

  if (!user) {
    console.warn(`[PAYMENT SERVICE] User ID ${userId} not found in database`);
    return { success: false, message: `User with ID ${userId} not found` };
  }

  console.log(`[PAYMENT SERVICE] Found user: ${user.fullName}, Wallet Balance: ${user.wallet?.balance || 0}`);

  // 4. Nếu user chưa có ví, tạo ví mới
  let walletId = user.wallet?.id;
  if (!walletId) {
    const newWallet = await prisma.wallet.create({
      data: { userId: userId, balance: 0 }
    });
    walletId = newWallet.id;
  }

  // 5. Kiểm tra giao dịch đã được xử lý chưa (Idempotency)
  const existingTx = await prisma.walletTransaction.findUnique({
    where: { gatewayTransactionId: gatewayTransactionId.toString() }
  });

  if (existingTx) {
    console.log(`[PAYMENT SERVICE] Transaction ${gatewayTransactionId} already processed, skipping.`);
    return { success: true, message: 'Transaction already processed', data: existingTx };
  }

  console.log(`[PAYMENT SERVICE] Starting database transaction to update balance...`);

  // 6. Thực hiện cộng tiền trong Transaction
  const result = await prisma.$transaction(async (tx) => {
    // Cập nhật số dư ví
    const updatedWallet = await tx.wallet.update({
      where: { id: walletId },
      data: { balance: { increment: parseFloat(amount) } }
    });

    // Tạo bản ghi giao dịch
    const transaction = await tx.walletTransaction.create({
      data: {
        walletId: walletId,
        type: 'credit',
        amount: parseFloat(amount),
        description: `Nạp tiền qua chuyển khoản (Sepay)`,
        gatewayTransactionId: gatewayTransactionId.toString(),
        reference: content
      }
    });

    return { updatedWallet, transaction };
  });

  // 7. Thông báo qua Socket.io
  try {
    const io = getIO();
    io.to(`user_${userId}`).emit('payment:success', {
      amount: parseFloat(amount),
      balance: result.updatedWallet.balance,
      message: `Nạp thành công ${parseFloat(amount).toLocaleString()}đ vào ví.`
    });
  } catch (err) {
    console.warn('[PAYMENT WEBHOOK] Socket notification failed:', err.message);
  }

  return { success: true, data: result };
};

/**
 * Tạo thông tin thanh toán (QR Code) cho người dùng
 * @param {number} userId 
 * @param {number} amount - Số tiền muốn nạp (mặc định 0 để người dùng tự nhập)
 */
export const createPaymentRequest = async (userId, amount = 0) => {
  const content = `SW${userId}`;
  const bank = process.env.SEPAY_BANK;
  const acc = process.env.SEPAY_ACC;
  const qrBase = process.env.SEPAY_QR_IMAGE_BASE;

  // Link VietQR: https://qr.sepay.vn/img?bank=<BANK>&acc=<ACC>&template=compact&amount=<AMT>&des=<CONTENT>
  const qrUrl = `${qrBase}?bank=${bank}&acc=${acc}&template=compact&amount=${amount}&des=${content}`;

  return {
    success: true,
    data: {
      userId,
      amount,
      content,
      bank,
      accountNumber: acc,
      qrUrl
    }
  };
};
