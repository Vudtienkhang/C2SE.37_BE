import prisma from '../prisma/prisma.js';
import notificationService from './notification.service.js';

/**
 * Tạo một khiếu nại mới cho chuyến đi
 * @param {Object} data - Dữ liệu khiếu nại (tripId, createdById, reason, description, evidenceUrls)
 * @returns {Promise<Object>} - Khiếu nại đã tạo
 */
export const createDispute = async (data) => {
  const { tripId, createdById, reason, description, evidenceUrls = [] } = data;

  // 1. Kiểm tra spam: Mỗi chuyến đi chỉ được có 1 khiếu nại đang hoạt động (chưa resolved)
  const existingDispute = await prisma.dispute.findFirst({
    where: {
      tripId: parseInt(tripId),
      status: { not: 'resolved' },
    },
  });

  if (existingDispute) {
    throw new Error('Chuyến đi này hiện đang có một khiếu nại đang được xử lý.');
  }

  // 2. Tạo khiếu nại và log history trong một transaction
  return await prisma.$transaction(async (tx) => {
    const dispute = await tx.dispute.create({
      data: {
        tripId: parseInt(tripId),
        createdById: parseInt(createdById),
        reason,
        description,
        evidenceUrls,
        status: 'open',
      },
    });

    await tx.disputeLog.create({
      data: {
        disputeId: dispute.id,
        action: 'CREATED',
        byUserId: parseInt(createdById),
      },
    });

    return dispute;
  });
};

/**
 * Lấy chi tiết khiếu nại theo ID
 * @param {number} id - ID của khiếu nại
 * @returns {Promise<Object>}
 */
export const getDisputeById = async (id) => {
  return await prisma.dispute.findUnique({
    where: { id: parseInt(id) },
    include: {
      createdBy: { select: { id: true, fullName: true, phone: true, avatarUrl: true } },
      resolvedBy: { select: { id: true, fullName: true, phone: true } },
      trip: {
        include: {
          customer: { include: { user: { include: { wallet: true } } } },
          driver: { include: { user: true } },
          payments: true,
          conversation: {
            include: {
              messages: {
                orderBy: { createdAt: 'asc' },
                include: { sender: { select: { fullName: true, role: true } } }
              }
            }
          },
          locationHistory: {
            orderBy: { createdAt: 'asc' }
          }
        },
      },
      logs: {
        include: {
          user: { select: { id: true, fullName: true, role: true } },
        },
        orderBy: { createdAt: 'asc' },
      },
    },
  });
};

/**
 * Giải quyết khiếu nại bằng cách Hoàn tiền (Refund)
 */
export const resolveWithRefund = async (id, adminId, refundAmount, note) => {
  return await prisma.$transaction(async (tx) => {
    const dispute = await tx.dispute.findUnique({
      where: { id: parseInt(id) },
      include: { trip: { include: { customer: { include: { user: { include: { wallet: true } } } } } } }
    });

    if (!dispute) throw new Error('Không tìm thấy khiếu nại');
    const customerWallet = dispute.trip.customer.user.wallet;

    if (!customerWallet) throw new Error('Khách hàng không có ví điện tử để hoàn tiền');

    // 1. Tạo giao dịch hoàn tiền
    await tx.walletTransaction.create({
      data: {
        walletId: customerWallet.id,
        type: 'refund',
        amount: parseFloat(refundAmount),
        description: `Hoàn tiền khiếu nại #${dispute.id}: ${note}`,
        reference: `DISPUTE_${dispute.id}`
      }
    });

    // 2. Cập nhật số dư ví
    await tx.wallet.update({
      where: { id: customerWallet.id },
      data: { balance: { increment: parseFloat(refundAmount) } }
    });

    // 3. Cập nhật trạng thái khiếu nại
    const updatedDispute = await tx.dispute.update({
      where: { id: parseInt(id) },
      data: {
        status: 'resolved',
        resolvedById: parseInt(adminId),
        resolvedAt: new Date()
      }
    });

    // 4. Log hành động
    await tx.disputeLog.create({
      data: {
        disputeId: updatedDispute.id,
        action: 'RESOLVED_WITH_REFUND',
        byUserId: parseInt(adminId)
      }
    });

    // 5. Gửi thông báo cho khách hàng
    try {
      await notificationService.createNotification(
        dispute.createdById,
        'Khiếu nại chuyến đi đã được giải quyết',
        `Khiếu nại #${dispute.id} của bạn đã được hoàn tiền ${parseFloat(refundAmount).toLocaleString('vi-VN')}đ. Lý do: ${note}`,
        'SUCCESS'
      );
    } catch (notifyError) {
      console.error('[DISPUTE SERVICE] Error sending refund notification:', notifyError.message);
    }

    return updatedDispute;
  });
};

/**
 * Giải quyết khiếu nại bằng cách Phạt tài xế (Penalty)
 */
export const resolveWithPenalty = async (id, adminId, penaltyPoints, reason) => {
  return await prisma.$transaction(async (tx) => {
    const dispute = await tx.dispute.findUnique({
      where: { id: parseInt(id) },
      include: { trip: true }
    });

    if (!dispute || !dispute.trip.driverId) throw new Error('Không tìm thấy thông tin tài xế để phạt');

    // 1. Log điểm phạt tài xế
    await tx.driverPointLog.create({
      data: {
        driverId: dispute.trip.driverId,
        amount: -parseFloat(penaltyPoints),
        reason: `Phạt từ khiếu nại #${dispute.id}: ${reason}`,
        tripId: dispute.tripId
      }
    });

    // 2. Cập nhật tổng điểm tài xế
    await tx.driver.update({
      where: { id: dispute.trip.driverId },
      data: { totalPoints: { decrement: parseFloat(penaltyPoints) } }
    });

    // 3. Cập nhật trạng thái khiếu nại
    const updatedDispute = await tx.dispute.update({
      where: { id: parseInt(id) },
      data: {
        status: 'resolved',
        resolvedById: parseInt(adminId),
        resolvedAt: new Date()
      }
    });

    // 4. Log hành động
    await tx.disputeLog.create({
      data: {
        disputeId: updatedDispute.id,
        action: 'RESOLVED_WITH_PENALTY',
        byUserId: parseInt(adminId)
      }
    });

    // 5. Gửi thông báo cho khách hàng và tài xế
    try {
      // Thông báo cho người khiếu nại (khách hàng)
      await notificationService.createNotification(
        dispute.createdById,
        'Khiếu nại chuyến đi đã được xử lý',
        `Khiếu nại #${dispute.id} của bạn đã được giải quyết. Đối tác tài xế đã bị xử phạt theo quy định.`,
        'SUCCESS'
      );

      // Thông báo cho tài xế
      await notificationService.notifyDriver(
        dispute.trip.driverId,
        'Bạn bị phạt điểm do khiếu nại',
        `Bạn bị trừ ${penaltyPoints} điểm do vi phạm trong chuyến đi #${dispute.tripId}. Lý do: ${reason}`,
        'WARNING'
      );
    } catch (notifyError) {
      console.error('[DISPUTE SERVICE] Error sending penalty notifications:', notifyError.message);
    }

    return updatedDispute;
  });
};

/**
 * Lấy danh sách khiếu nại của một chuyến đi
 * @param {number} tripId 
 * @returns {Promise<Array>}
 */
export const getDisputesByTrip = async (tripId) => {
  return await prisma.dispute.findMany({
    where: { tripId: parseInt(tripId) },
    include: {
      logs: true,
    },
    orderBy: { createdAt: 'desc' },
  });
};

/**
 * Cập nhật trạng thái khiếu nại (Admin)
 * @param {number} id - ID khiếu nại
 * @param {string} status - Trạng thái mới (investigating, resolved, dismissed)
 * @param {number} adminId - ID của admin thực hiện
 * @param {string} note - Lý do hoặc ghi chú khi thay đổi trạng thái
 * @returns {Promise<Object>}
 */
export const updateDisputeStatus = async (id, status, adminId, note = '') => {
  const validStatuses = ['investigating', 'resolved', 'dismissed'];
  if (!validStatuses.includes(status)) {
    throw new Error('Trạng thái không hợp lệ');
  }

  return await prisma.$transaction(async (tx) => {
    const updateData = { status };
    
    if (status === 'resolved' || status === 'dismissed') {
      updateData.resolvedById = parseInt(adminId);
      updateData.resolvedAt = new Date();
    }

    const updatedDispute = await tx.dispute.update({
      where: { id: parseInt(id) },
      data: updateData,
    });

    await tx.disputeLog.create({
      data: {
        disputeId: updatedDispute.id,
        action: `STATUS_CHANGED_TO_${status.toUpperCase()}`,
        byUserId: parseInt(adminId),
        details: note // Lưu thêm chi tiết nếu có
      },
    });

    // 5. Gửi thông báo cho người dùng
    try {
      const dispute = await tx.dispute.findUnique({ 
        where: { id: parseInt(id) },
        include: { trip: true }
      });
      let title = '';
      let content = '';
      let type = 'INFO';

      if (status === 'dismissed') {
        title = 'Khiếu nại bị bác bỏ';
        content = `Khiếu nại #${id} của bạn đã bị bác bỏ. Lý do: ${note || 'Không có lý do cụ thể'}`;
        type = 'WARNING';

        // Thông báo thêm cho tài xế
        try {
          if (dispute.trip?.driverId) {
            await notificationService.notifyDriver(
              dispute.trip.driverId,
              'Khiếu nại đã được giải quyết',
              `Khiếu nại liên quan đến chuyến đi #${dispute.tripId} đã được bác bỏ. Điểm tín nhiệm của bạn không bị ảnh hưởng.`,
              'SUCCESS'
            );
          }
        } catch (driverNotifyError) {
          console.error('[DISPUTE SERVICE] Error notifying driver on dismissal:', driverNotifyError.message);
        }
      } else if (status === 'investigating') {
        title = 'Khiếu nại đang được kiểm tra';
        content = `Khiếu nại #${id} của bạn đang được ban quản trị kiểm tra xử lý.`;
      }

      if (title) {
        await notificationService.createNotification(dispute.createdById, title, content, type);
      }
    } catch (notifyError) {
      console.error('[DISPUTE SERVICE] Error sending status update notification:', notifyError.message);
    }

    return updatedDispute;
  });
};

/**
 * Lấy danh sách khiếu nại (có phân trang và lọc - dành cho Admin)
 * @param {Object} filters 
 * @returns {Promise<Object>}
 */
export const getAllDisputes = async (filters = {}) => {
  const { status, reason, skip = 0, take = 20 } = filters;
  
  const where = {};
  if (status) where.status = status;
  if (reason) where.reason = { contains: reason, mode: 'insensitive' };

  const [total, items] = await Promise.all([
    prisma.dispute.count({ where }),
    prisma.dispute.findMany({
      where,
      include: {
        createdBy: { select: { fullName: true, phone: true } },
        trip: { select: { id: true, status: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip: parseInt(skip),
      take: parseInt(take),
    }),
  ]);

  return { total, items, skip, take };
};
