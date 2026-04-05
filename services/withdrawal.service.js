import prisma from '../prisma/prisma.js';
import bcrypt from 'bcryptjs';
import { getIO } from './socket.service.js';
import { invalidateProfileCache } from './auth.services.js';
import notificationService from './notification.service.js';

/**
 * Tạo yêu cầu rút tiền mới
 */
export const createWithdrawalRequest = async (userId, data) => {
  const { amount, bankName, bankCode, accountNumber, accountName, password } = data;
  const numericUserId = parseInt(userId, 10);

  // 1. Kiểm tra User & Password
  const user = await prisma.user.findUnique({
    where: { id: numericUserId },
    include: { wallet: true }
  });

  if (!user) throw new Error('Người dùng không tồn tại');

  const isPasswordValid = await bcrypt.compare(password, user.password);
  if (!isPasswordValid) throw new Error('Mật khẩu không chính xác');

  // 2. Kiểm tra số dư
  const balance = user.wallet?.balance || 0;
  if (balance < amount) throw new Error('Số dư không đủ để thực hiện giao dịch');
  if (amount < 10000) throw new Error('Số tiền rút tối thiểu là 10,000đ');

  // 2.5 Tạo mã tham chiếu duy nhất (VD: RT123456)
  const referenceCode = 'RT' + Math.random().toString(36).substring(2, 8).toUpperCase();

  // 3. Thực hiện Transaction: Trừ tiền ví & Tạo yêu cầu rút
  const result = await prisma.$transaction(async (tx) => {
    // Cập nhật số dư ví (Decremented immediately)
    const updatedWallet = await tx.wallet.update({
      where: { userId: numericUserId },
      data: { balance: { decrement: parseFloat(amount) } }
    });

    // Tạo bản ghi giao dịch (Dấu -)
    await tx.walletTransaction.create({
      data: {
        walletId: user.wallet.id,
        type: 'withdrawal',
        amount: parseFloat(amount),
        description: `Yêu cầu rút tiền về ${bankName} [${referenceCode}]`,
        reference: referenceCode
      }
    });

    // Tạo yêu cầu rút tiền
    const request = await tx.withdrawalRequest.create({
      data: {
        userId: numericUserId,
        amount: parseFloat(amount),
        bankName,
        bankCode,
        accountNumber,
        accountName,
        referenceCode,
        status: 'pending'
      }
    });

    return request;
  });

  // 4. Clear Profile Cache (Redis)
  await invalidateProfileCache(numericUserId);

  // 5. Thông báo cho Admin qua Socket
  try {
    const io = getIO();
    // Lấy số lượng yêu cầu đang chờ để gửi badge mới
    const pendingCount = await prisma.withdrawalRequest.count({
      where: { status: 'pending' }
    });
    
    io.emit('admin:new_withdrawal', { 
      requestId: result.id, 
      amount: result.amount,
      referenceCode: result.referenceCode,
      pendingCount 
    });
    
    // Thông báo cập nhật ví cho chính user (để hiện số dư mới ngay lập tức)
    io.to(`user_${userId}`).emit('wallet:updated', { 
      balance: balance - amount,
      message: 'Yêu cầu rút tiền đã được gửi và đang chờ duyệt.'
    });
  } catch (err) {
    console.warn('[WITHDRAWAL] Socket notification failed:', err.message);
  }

  return result;
};

/**
 * Lấy lịch sử yêu cầu rút tiền của user
 */
export const getUserWithdrawals = async (userId) => {
  return await prisma.withdrawalRequest.findMany({
    where: { userId: parseInt(userId, 10) },
    orderBy: { createdAt: 'desc' }
  });
};

/**
 * Admin xử lý yêu cầu rút tiền
 */
export const updateWithdrawalStatus = async (requestId, status, adminNote = '', transactionId = '', proofImageUrl = '') => {
  const request = await prisma.withdrawalRequest.findUnique({
    where: { id: parseInt(requestId, 10) },
    include: { user: { include: { wallet: true } } }
  });

  if (!request) throw new Error('Yêu cầu không tồn tại');
  if (request.status !== 'pending') throw new Error('Yêu cầu này đã được xử lý rồi');

  return await prisma.$transaction(async (tx) => {
    const updatedRequest = await tx.withdrawalRequest.update({
      where: { id: request.id },
      data: { status, adminNote, transactionId, proofImageUrl }
    });

    // Cập nhật WalletTransaction tương ứng (nếu là Approved)
    if (status === 'approved' && request.referenceCode) {
      await tx.walletTransaction.updateMany({
        where: { reference: request.referenceCode },
        data: { proofImageUrl }
      });
    }

    // Nếu từ chối -> Hoàn tiền lại vào ví
    if (status === 'rejected') {
      await tx.wallet.update({
        where: { id: request.user.wallet.id },
        data: { balance: { increment: request.amount } }
      });

      await tx.walletTransaction.create({
        data: {
          walletId: request.user.wallet.id,
          type: 'refund',
          amount: request.amount,
          description: `Hoàn tiền yêu cầu rút tiền bị từ chối: ${adminNote}`,
          reference: `withdraw_reject_${request.id}`
        }
      });
    }

    // Thông báo cho user
    try {
      const io = getIO();
      const updatedUserWallet = await tx.wallet.findUnique({ where: { id: request.user.wallet.id } });
      
      io.to(`user_${request.userId}`).emit('withdrawal:status_updated', {
        id: request.id,
        status,
        adminNote,
        newBalance: updatedUserWallet.balance
      });
      
      if (status === 'rejected') {
        io.to(`user_${request.userId}`).emit('wallet:updated', { 
          balance: updatedUserWallet.balance 
        });
      }
    } catch (err) {
      console.warn('[WITHDRAWAL] Socket update notification failed:', err.message);
    }

    // Clear Profile Cache (Redis)
    await invalidateProfileCache(request.userId);

    // Gửi thông báo hệ thống cho người dùng
    try {
        const title = status === 'approved' ? 'Rút tiền thành công' : 'Rút tiền thất bại';
        const content = status === 'approved' 
            ? `Yêu cầu rút tiền ${request.referenceCode} của bạn đã được phê duyệt thành công.` 
            : `Yêu cầu rút tiền ${request.referenceCode} của bạn đã bị từ chối. Lý do: ${adminNote || 'Không có lý do cụ thể'}`;
            
        await notificationService.createNotification(request.userId, title, content, status === 'approved' ? 'WALLET' : 'ERROR');
    } catch (notifError) {
        console.error('[WITHDRAWAL SERVICE] Lỗi gửi thông báo hệ thống:', notifError);
    }

    return updatedRequest;
  });
};

/**
 * Lấy tất cả yêu cầu rút tiền (Cho Admin)
 */
export const getAllWithdrawals = async (status) => {
  const where = status ? { status } : {};
  return await prisma.withdrawalRequest.findMany({
    where,
    include: {
      user: {
        select: { id: true, fullName: true, phone: true }
      }
    },
    orderBy: { createdAt: 'desc' }
  });
};

/**
 * Lấy số lượng yêu cầu đang chờ duyệt
 */
export const getPendingCount = async () => {
  return await prisma.withdrawalRequest.count({
    where: { status: 'pending' }
  });
};
