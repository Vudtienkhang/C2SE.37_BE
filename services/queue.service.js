import { Worker } from 'bullmq';
import { tripTasksQueue } from '../lib/queue.js';
import redis from '../lib/redis.js';
import prisma from '../prisma/prisma.js';
import * as authAdminService from './admin.service.js';
import { updateDriverScore } from './driver-score.service.js';
import * as socketService from './socket.service.js';
import { invalidateProfileCache } from './auth.services.js';

console.log('[WORKER] Trip Tasks Worker initialized');

/**
 * Worker xử lý các tác vụ background liên quan đến chuyến đi
 */
const worker = new Worker('trip-tasks', async (job) => {
  const type = job.name;
  const data = job.data;
  console.log(`[WORKER] Processing job ${job.id} of type ${type}`);

  try {
    switch (type) {
      case 'PROCESS_TRIP_ACCEPTANCE':
        await processTripAcceptance(data);
        break;
      case 'PROCESS_TRIP_COMPLETION':
        await processTripCompletion(data);
        break;
      case 'PROCESS_TRIP_CANCELLATION':
        await processTripCancellation(data);
        break;
      case 'PROCESS_REVIEW_SCORE':
        await processReviewScore(data);
        break;
      default:
        console.warn(`[WORKER] Unknown job type: ${type}`);
    }
  } catch (error) {
    console.error(`[WORKER] Error processing job ${job.id}:`, error);
    throw error; // Để BullMQ tự động retry nếu cần
  }
}, {
  connection: redis
});

/**
 * Xử lý các tác vụ phụ sau khi tài xế chấp nhận chuyến đi
 * (Trừ tiền ví, áp dụng voucher, v.v.)
 */
async function processTripAcceptance(data) {
  const { tripId: rawTripId, passengerId: rawPassengerId, paymentMethod, finalPrice, voucherId: rawVoucherId, discountAmount } = data;
  const tripId = parseInt(rawTripId);
  const passengerId = parseInt(rawPassengerId);
  const voucherId = rawVoucherId ? parseInt(rawVoucherId) : null;

  console.log(`[PROCESS_TRIP_ACCEPTANCE] Trip #${tripId}, Method: ${paymentMethod}, Final: ${finalPrice}, Discount: ${discountAmount}`);

  await prisma.$transaction(async (tx) => {
    // 1. Thanh toán bằng ví (nếu có)
    if (paymentMethod === 'WALLET') {
      const wallet = await tx.wallet.findUnique({ where: { userId: passengerId } });
      if (wallet && wallet.balance >= finalPrice) {
        await tx.wallet.update({
          where: { id: wallet.id },
          data: { balance: { decrement: finalPrice } }
        });

        await tx.walletTransaction.create({
          data: {
            walletId: wallet.id,
            type: 'debit',
            amount: finalPrice,
            description: `Thanh toán chuyến đi #${tripId} (Giữ tiền)`,
            reference: `trip_${tripId}`
          }
        });
      }
    }

    // 1.5 Tạo bản ghi Payment (Quan trọng để tra cứu sau này)
    await tx.payment.create({
      data: {
        tripId: tripId,
        amount: finalPrice,
        method: paymentMethod,
        status: paymentMethod === 'WALLET' ? 'success' : 'pending' // Nếu là ví thì đã trừ tiền thành công
      }
    });

    // 2. Cập nhật Voucher (nếu có)
    if (voucherId) {
      await tx.voucherUsage.create({
        data: {
          voucherId: voucherId,
          userId: passengerId,
          tripId: tripId,
          discountAmount: discountAmount
        }
      });
      
      await tx.voucher.update({
        where: { id: voucherId },
        data: { usedCount: { increment: 1 } }
      });
    }
  });

  // 3. Clear Passenger Profile Cache (Redis)
  await invalidateProfileCache(passengerId);

  console.log(`[WORKER] Post-acceptance tasks completed for Trip #${tripId}`);
}

/**
 * Xử lý các tác vụ phụ sau khi chuyến đi hoàn thành
 * (Tính hoa hồng, cộng ví tài xế, cập nhật hạng tài xế)
 */
async function processTripCompletion(data) {
  const { tripId, driverId, finalPrice: finalPriceFromJob, paymentMethod: methodFromJob } = data;
  console.log(`[WORKER] Starting PROCESS_TRIP_COMPLETION for Trip #${tripId}. Data:`, data);

  let tripResult = null;

  try {
    await prisma.$transaction(async (tx) => {
      const trip = await tx.trip.findUnique({
        where: { id: tripId },
        include: { 
          driver: { include: { DriverRank: true } }, 
          payments: true,
          feeBreakdowns: true
        }
      });

      if (!trip || !trip.driver) {
        console.warn(`[WORKER] Trip #${tripId} not found or has no driver assigned!`);
        return;
      }

      // GUARD: Nếu chuyến đi đã bị hủy, không xử lý completion nữa
      if (trip.status === 'cancelled') {
        console.warn(`[WORKER] Trip #${tripId} was CANCELLED. Skipping completion logic.`);
        return;
      }

      tripResult = trip;

      const finalPrice = parseFloat(finalPriceFromJob || trip.finalPrice || trip.priceEstimate || 0);

      // 0. Cập nhật trạng thái thanh toán & Chuyến đi
      await tx.payment.updateMany({
        where: { tripId: trip.id, status: 'pending' },
        data: { status: 'success', paidAt: new Date() }
      });

      await tx.trip.update({
        where: { id: trip.id },
        data: { 
          finalPrice: finalPrice,
          status: 'completed'
        }
      });

      const method = trip.payments[0]?.method || methodFromJob || 'CASH';

      // 1. TÍNH TOÁN DỰA TRÊN BREAKDOWN (QUAN TRỌNG)
      const baseFareRecord = trip.feeBreakdowns.find(f => f.feeType === 'base_fare');
      const baseFare = baseFareRecord ? baseFareRecord.amount : (trip.priceEstimate || 0);
      
      const surcharges = trip.feeBreakdowns
        .filter(f => f.feeType.startsWith('surcharge_'))
        .reduce((sum, f) => sum + f.amount, 0);
      
      const systemFeeRecord = trip.feeBreakdowns.find(f => f.feeType === 'system_fee');
      const systemFee = systemFeeRecord ? systemFeeRecord.amount : 0;

      // Hoa hồng chỉ tính trên BaseFare
      const rate = trip.driver?.DriverRank?.platformRate ?? 20;
      const commissionAmount = baseFare * (rate / 100);

      // Tổng thu nhập của tài xế = (BaseFare - Hoa hồng) + Surcharges (100%)
      const driverEarnings = (baseFare - commissionAmount) + surcharges;

      // Số tiền cần điều chỉnh trong ví (nếu thanh toán ví thì cộng DriverEarnings, nếu tiền mặt thì chỉ bù Voucher/Trừ hoa hồng)
      const originalPrice = baseFare + surcharges + systemFee;
      const discountAmount = Math.max(0, originalPrice - finalPrice);

      console.log(`[COMPLETION_LOG] Trip #${tripId}, Method: ${method}, Base: ${baseFare}, Surcharges: ${surcharges}, SystemFee: ${systemFee}, Earnings: ${driverEarnings}, Commission: ${commissionAmount}`);

      const driverWallet = await tx.wallet.findUnique({ where: { userId: trip.driver.userId } });
      
      if (driverWallet) {
        if (method === 'WALLET') {
          // Ví: Khách đã trả toàn bộ finalPrice. Ta cộng DriverEarnings cho tài xế.
          await tx.wallet.update({
            where: { id: driverWallet.id },
            data: { balance: { increment: driverEarnings } }
          });

          await tx.walletTransaction.create({
            data: {
              walletId: driverWallet.id,
              type: 'credit',
              amount: driverEarnings,
              description: `Thu nhập chuyến đi #${tripId} (Phụ phí: ${surcharges})`,
              reference: `trip_${tripId}`
            }
          });
        } else {
          // Tiền mặt: Tài xế đã cầm finalPrice (tiền mặt từ khách).
          // Tài xế nợ platform: Hoa hồng + SystemFee.
          // Tài xế được platform bù: Voucher (Phần chênh lệch giữa giá gốc và giá khách trả).
          const netAdjustment = discountAmount - (commissionAmount + systemFee);
          
          if (netAdjustment !== 0) {
            await tx.wallet.update({
              where: { id: driverWallet.id },
              data: { balance: { increment: netAdjustment } }
            });

            await tx.walletTransaction.create({
              data: {
                walletId: driverWallet.id,
                type: netAdjustment > 0 ? 'credit' : 'commission',
                amount: Math.abs(netAdjustment),
                description: netAdjustment > 0 ? `Bồi hoàn voucher chuyến đi #${tripId}` : `Khấu trừ hoa hồng & phí hệ thống #${tripId}`,
                reference: `trip_${tripId}`
              }
            });
          }
        }
      }

      // 3. Tạo bản ghi hoa hồng hệ thống (Lưu cả Commission và SystemFee để Admin dễ thống kê)
      // Lưu ý: commissionAmount trong DB hiện tại có thể chỉ hiểu là phần % thu thêm.
      // Chúng ta sẽ lưu Commission thực tế.
      await tx.tripCommission.create({
        data: {
          tripId: trip.id,
          driverId: trip.driverId,
          commissionPolicyId: null,
          commissionAmount: commissionAmount + systemFee // TỔNG TIỀN HỆ THỐNG THU ĐƯỢC
        }
      });

    }, { timeout: 15000 });
  } catch (err) {
    console.error(`[WORKER ERROR] Transaction failed for Trip #${tripId}:`, err);
    throw err;
  }

  // --- CÁC TÁC VỤ SAU KHI GIAO DỊCH TÀI CHÍNH THÀNH CÔNG ---
  if (tripResult) {
    try {
      const finalDriverId = driverId || tripResult.driverId; 

      // 5. CỘNG ĐIỂM HOÀN THÀNH CHUYẾN ĐI & THƯỞNG
      await updateDriverScore(finalDriverId, 'TRIP_COMPLETED', tripId).catch(e => console.error('[SCORE ERROR]', e));

      // Thưởng đường dài (> 15km)
      if (tripResult.distanceKm > 15) {
        await updateDriverScore(finalDriverId, 'LONG_TRIP_BONUS', tripId).catch(e => console.error('[SCORE ERROR]', e));
      }

      // Thưởng giờ đêm (22:00 - 05:00)
      const hour = new Date().getHours();
      if (hour >= 22 || hour < 5) {
        await updateDriverScore(finalDriverId, 'NIGHT_TRIP_BONUS', tripId).catch(e => console.error('[SCORE ERROR]', e));
      }

      // Thưởng giờ cao điểm (07:00-09:00, 16:30-19:00)
      const now = new Date();
      const currentHour = now.getHours();
      const currentMin = now.getMinutes();
      const isRushHour = (currentHour === 7 || currentHour === 8) || 
                         (currentHour === 16 && currentMin >= 30) || 
                         (currentHour === 17 || currentHour === 18);
      
      if (isRushHour) {
        await updateDriverScore(finalDriverId, 'PEAK_HOUR_BONUS', tripId).catch(e => console.error('[SCORE ERROR]', e));
      }

      // 4. Cập nhật hạng tài xế (Sau khi đã cộng điểm và tăng số chuyến)
      await authAdminService.updateDriverRankAfterTrip(finalDriverId).catch(e => console.error('[RANK ERROR]', e));

      // 6. THÔNG BÁO CẬP NHẬT VÍ (REAL-TIME)
      const finalWallet = await prisma.wallet.findUnique({ 
        where: { userId: tripResult.driver.userId } 
      });
      
      if (finalWallet) {
        console.log(`[WORKER] Emitting wallet:updated for user ${tripResult.driver.userId}, balance: ${finalWallet.balance}`);
        
        // Clear Driver Profile Cache (Redis)
        await invalidateProfileCache(tripResult.driver.userId);

        socketService.emitToUser(tripResult.driver.userId, 'wallet:updated', { 
          balance: finalWallet.balance 
        });
      }
    } catch (error) {
      console.error(`[WORKER] Error in post-completion tasks for Trip #${tripId}:`, error);
    }
  }

  console.log(`[WORKER] Post-completion tasks completed for Trip #${tripId}`);
}

/**
 * Xử lý cộng điểm dựa trên đánh giá sao
 */
async function processReviewScore(data) {
  const { driverId, rating, tripId } = data;
  let reason = '';
  
  if (rating === 5) reason = 'RATING_5_STAR';
  else if (rating === 4) reason = 'RATING_4_STAR';
  else if (rating === 3) reason = 'RATING_3_STAR';
  else if (rating === 2) reason = 'RATING_2_STAR';
  else if (rating === 1) reason = 'RATING_1_STAR';

  if (reason) {
    await updateDriverScore(driverId, reason, tripId);
  }
}

/**
 * Xử lý trừ điểm khi chuyến đi bị hủy bởi tài xế
 */
async function processTripCancellation(data) {
  const { tripId, driverId, cancelledBy } = data;
  console.log(`[WORKER] Starting PROCESS_TRIP_CANCELLATION for Trip #${tripId} by ${cancelledBy}`);

  // Fetch trạng thái hiện tại để kiểm tra
  const trip = await prisma.trip.findUnique({
    where: { id: parseInt(tripId) },
    select: { status: true }
  });

  // Nếu chuyến đi bằng cách nào đó đã được đánh dấu là completed trước đó, không được phép cancel và refund tự động nữa
  if (trip?.status === 'completed') {
    console.warn(`[WORKER] Trip #${tripId} was already COMPLETED. Cannot cancel and refund automatically.`);
    return;
  }
  
  try {
    // 1. Hoàn lại Voucher (nếu có sử dụng)
    const usage = await prisma.voucherUsage.findFirst({
      where: { tripId: parseInt(tripId) }
    });

    if (usage) {
      await prisma.$transaction([
        prisma.voucherUsage.delete({ where: { id: usage.id } }),
        prisma.voucher.update({
          where: { id: usage.voucherId },
          data: { usedCount: { decrement: 1 } }
        })
      ]);
      console.log(`[WORKER] Reverted voucher usage for Trip #${tripId}, Voucher #${usage.voucherId}`);
    }

    // 1.5. Hoàn tiền vào ví (nếu thanh toán bằng ví và đã trừ tiền)
    const walletPayments = await prisma.payment.findMany({
      where: { 
        tripId: parseInt(tripId), 
        method: 'WALLET', 
        status: 'success' 
      }
    });

    for (const payment of walletPayments) {
      const tripDetail = await prisma.trip.findUnique({
        where: { id: parseInt(tripId) },
        select: { customer: { select: { userId: true } } }
      });

      if (tripDetail?.customer?.userId) {
        const wallet = await prisma.wallet.findUnique({
          where: { userId: tripDetail.customer.userId }
        });

        if (wallet) {
          await prisma.$transaction([
            prisma.wallet.update({
              where: { id: wallet.id },
              data: { balance: { increment: payment.amount } }
            }),
            prisma.walletTransaction.create({
              data: {
                walletId: wallet.id,
                type: 'refund',
                amount: payment.amount,
                description: `Hoàn tiền huỷ chuyến đi #${tripId}`,
                reference: `trip_cancel_${tripId}`
              }
            }),
            prisma.payment.update({
              where: { id: payment.id },
              data: { status: 'refunded' }
            })
          ]);
          console.log(`[WORKER] Refunded ${payment.amount} to user ${tripDetail.customer.userId} for cancelled Trip #${tripId}`);

          // Cập nhật lại số dư trên app
          try {
            // Clear Passenger Profile Cache (Redis)
            await invalidateProfileCache(tripDetail.customer.userId);

            socketService.emitToUser(tripDetail.customer.userId, 'wallet:updated', { 
              balance: wallet.balance + payment.amount 
            });
          } catch (e) {
             console.error("[WORKER] Emit wallet:updated failed", e);
          }
        }
      }
    }

    // 2. Trừ điểm hủy chuyến (chỉ khi tài xế huỷ)
    if (driverId && cancelledBy === 'driver') {
      await updateDriverScore(driverId, 'TRIP_CANCELLED', tripId);
      
      // Kiểm tra lại hạng (có thể bị hạ hạng nếu điểm xuống thấp)
      await authAdminService.updateDriverRankAfterTrip(driverId);
    } else {
      console.log(`[WORKER] Trip #${tripId} cancelled by ${cancelledBy}. No point deduction for driver.`);
    }
  } catch (error) {
    console.error(`[WORKER ERROR] Cancellation tasks failed for Trip #${tripId}:`, error);
  }
}

worker.on('completed', (job) => {
  console.log(`[WORKER SUCCESS] Job ${job.id} (${job.name}) processed successfully.`);
});

worker.on('failed', (job, err) => {
  console.error(`[WORKER FAILURE] Job ${job.id} (${job.name}) failed:`, err.message);
});
