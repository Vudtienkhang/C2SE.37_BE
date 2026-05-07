import prisma from '../prisma/prisma.js';
import { getIO } from './socket.service.js';
import { invalidateProfileCache } from './auth.services.js';

/**
 * Xử lý giao dịch Tiền Tip
 * @param {Object} tx - Prisma transaction context (optional)
 * @param {Object} tipData - Dữ liệu tip { tripId, customerId, driverId, amount }
 */
export const processTip = async (tx, tipData) => {
  const { tripId, customerId, driverId, amount } = tipData;

  if (!amount || amount <= 0) return null;

  // 1. Kiểm tra chuyến đi có tồn tại không
  const trip = await tx.trip.findUnique({
    where: { id: tripId }
  });
  if (!trip) {
    throw new Error(`Không tìm thấy chuyến đi với ID #${tripId}`);
  }

  // 2. Lấy thông tin ví của khách hàng và tài xế
  const customer = await tx.customer.findUnique({
    where: { id: customerId },
    include: { user: { include: { wallet: true } } }
  });

  const driver = await tx.driver.findUnique({
    where: { id: driverId },
    include: { user: { include: { wallet: true } } }
  });

  if (!customer) {
    throw new Error(`Không tìm thấy khách hàng với ID #${customerId}. Kiểm tra lại liên kết dữ liệu.`);
  }

  if (!driver) {
    throw new Error(`Không tìm thấy tài xế với ID #${driverId}. Kiểm tra lại liên kết dữ liệu.`);
  }

  if (!customer.user?.wallet) {
    throw new Error('Khách hàng chưa có ví điện tử');
  }

  if (!driver.user?.wallet) {
    throw new Error('Tài xế chưa có ví điện tử');
  }

  const customerWallet = customer.user.wallet;
  const driverWallet = driver.user.wallet;

  // Kiểm tra số dư ví khách hàng
  if (customerWallet.balance < amount) {
    throw new Error('Số dư ví không đủ để thực hiện tip');
  }

  // 1. Tạo bản ghi TripTip
  const tip = await tx.tripTip.create({
    data: {
      tripId,
      customerId,
      driverId,
      amount,
      status: 'success'
    }
  });

  // 2. Cập nhật Trip.tipTotalAmount
  await tx.trip.update({
    where: { id: tripId },
    data: { tipTotalAmount: { increment: amount } }
  });

  // 3. Trừ tiền ví khách hàng
  await tx.wallet.update({
    where: { id: customerWallet.id },
    data: { balance: { decrement: amount } }
  });

  await tx.walletTransaction.create({
    data: {
      walletId: customerWallet.id,
      type: 'debit',
      amount: amount,
      description: `Tip cho tài xế - Chuyến đi #${tripId}`,
      reference: `TIP_${tip.id}`
    }
  });

  // 4. Cộng tiền ví tài xế (100%)
  await tx.wallet.update({
    where: { id: driverWallet.id },
    data: { balance: { increment: amount } }
  });

  await tx.walletTransaction.create({
    data: {
      walletId: driverWallet.id,
      type: 'credit',
      amount: amount,
      description: `Nhận tiền tip - Chuyến đi #${tripId}`,
      reference: `TIP_${tip.id}`
    }
  });

  // 5. Ghi Log Tip (Nếu schema yêu cầu)
  await tx.tipLog.create({
    data: {
      tipId: tip.id,
      performedBy: customer.userId,
      action: 'CUSTOMER_TIPPED'
    }
  });

  // 6. Xóa Cache Profile của cả 2 bên để cập nhật số dư/lịch sử giao dịch tức thì
  await Promise.all([
    invalidateProfileCache(customer.userId),
    invalidateProfileCache(driver.userId)
  ]).catch(err => console.warn('Lỗi khi xóa cache sau tip:', err.message));

  // 7. Phát tín hiệu socket để App cập nhật số dư realtime
  try {
    const io = getIO();
    if (io) {
      io.to(`user_${customer.userId}`).emit('wallet:updated', { reason: 'tip_sent', amount });
      io.to(`user_${driver.userId}`).emit('wallet:updated', { reason: 'tip_received', amount });
    }
  } catch (err) {}

  return tip;
};

/**
 * Gửi thông báo tip thành công qua socket
 */
export const notifyDriverTip = (driverUserId, amount, tripId) => {
  try {
    const io = getIO();
    if (io) {
      io.to(`user_${driverUserId}`).emit('notification:new', {
        title: 'Bạn nhận được tiền tip!',
        content: `Khách hàng đã tip cho bạn ${amount.toLocaleString()}đ cho chuyến đi #${tripId}.`,
        type: 'TIP_RECEIVED',
        data: { tripId, amount }
      });
    }
  } catch (error) {
    console.warn('Gửi thông báo tip thất bại:', error.message);
  }
};
