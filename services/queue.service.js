import { Worker } from 'bullmq';
import { tripTasksQueue } from '../lib/queue.js';
import redis from '../lib/redis.js';
import prisma from '../prisma/prisma.js';
import * as authAdminService from './admin.service.js';
import { updateDriverScore } from './driver-score.service.js';
import * as socketService from './socket.service.js';

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
          payments: true 
        }
      });

      if (!trip || !trip.driver) {
        console.warn(`[WORKER] Trip #${tripId} not found or has no driver assigned!`);
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

      // ƯU TIÊN: Lấy phương thức thanh toán thực tế từ DB (tránh việc Frontend gửi nhầm hoặc thiếu)
      const method = trip.payments[0]?.method || methodFromJob || 'CASH';
      console.log(`[WORKER] Resolved payment method for Trip #${tripId}: ${method} (Source: ${trip.payments[0]?.method ? 'DB' : 'JobData'})`);

      // 1. Tính hoa hồng DỰA TRÊN GIÁ GỐC (PRICE ESTIMATE)
      const originalPrice = parseFloat(trip.priceEstimate || finalPrice || 0);
      const discountAmount = Math.max(0, originalPrice - finalPrice);
      
      const rate = trip.driver?.DriverRank?.platformRate ?? 20;
      const commissionAmount = originalPrice * (rate / 100);

      console.log(`[COMPLETION_LOG] Trip #${tripId}, Method: ${method}, Original: ${originalPrice}, Final: ${finalPrice}, Discount: ${discountAmount}, Commission: ${commissionAmount}`);

      // 2. Cập nhật ví tài xế
      const driverWallet = await tx.wallet.findUnique({ where: { userId: trip.driver.userId } });
      
      if (driverWallet) {
        if (method === 'WALLET') {
          // Cộng toàn bộ GIÁ GỐC vào ví 
          await tx.wallet.update({
            where: { id: driverWallet.id },
            data: { balance: { increment: originalPrice } }
          });

          await tx.walletTransaction.create({
            data: {
              walletId: driverWallet.id,
              type: 'credit',
              amount: originalPrice,
              description: `Thu nhập chuyến đi #${tripId} (Thanh toán Ví)`,
              reference: `trip_${tripId}`
            }
          });
        } else {
          // Tiền mặt: Bù Voucher
          if (discountAmount > 0) {
            await tx.wallet.update({
              where: { id: driverWallet.id },
              data: { balance: { increment: discountAmount } }
            });

            await tx.walletTransaction.create({
              data: {
                walletId: driverWallet.id,
                type: 'credit',
                amount: discountAmount,
                description: `Bồi hoàn Voucher chuyến đi #${tripId}`,
                reference: `trip_${tripId}`
              }
            });
          }
        }

        // TRỪ PHÍ HOA HỒNG
        await tx.wallet.update({
          where: { id: driverWallet.id },
          data: { balance: { decrement: commissionAmount } }
        });

        await tx.walletTransaction.create({
          data: {
            walletId: driverWallet.id,
            type: 'commission',
            amount: commissionAmount,
            description: `Phí hoa hồng chuyến đi #${tripId} (${rate}%)`,
            reference: `trip_${tripId}`
          }
        });
      }

      // 3. Tạo bản ghi hoa hồng hệ thống
      await tx.tripCommission.create({
        data: {
          tripId: trip.id,
          driverId: trip.driverId,
          commissionPolicyId: null,
          commissionAmount: commissionAmount
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
  const { tripId, driverId } = data;
  console.log(`[WORKER] Starting PROCESS_TRIP_CANCELLATION for Trip #${tripId}`);
  
  try {
    // Trừ điểm hủy chuyến
    await updateDriverScore(driverId, 'TRIP_CANCELLED', tripId);
    
    // Kiểm tra lại hạng (có thể bị hạ hạng nếu điểm xuống thấp)
    await authAdminService.updateDriverRankAfterTrip(driverId);
  } catch (error) {
    console.error(`[WORKER ERROR] Cancellation score update failed for Trip #${tripId}:`, error);
  }
}

worker.on('completed', (job) => {
  console.log(`[WORKER SUCCESS] Job ${job.id} (${job.name}) processed successfully.`);
});

worker.on('failed', (job, err) => {
  console.error(`[WORKER FAILURE] Job ${job.id} (${job.name}) failed:`, err.message);
});
