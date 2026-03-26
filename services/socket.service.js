
      import { Server } from 'socket.io';
import prisma from '../prisma/prisma.js';
import * as authAdminService from './admin.service.js';

let io;
const pendingTrips = new Map(); // requestId -> { data, driverIds, currentIndex, timeout, customerSocketId }

export const initSocket = (server) => {
  io = new Server(server, {
    cors: {
      origin: '*', 
      methods: ['GET', 'POST'],
    },
  });

  console.log('Socket.io initialized');

  io.on('connection', (socket) => {
    socket.on('user:register', (userId) => {
      socket.join(`user_${userId}`);
      console.log(`User ${userId} joined their private room`);
    });

    socket.on('driver:register', async (driverId) => {
      try {
        const id = parseInt(driverId);
        if (isNaN(id)) return;

        socket.join(`driver_${id}`);
        socket.join('drivers');
        console.log(`[SOCKET] Driver ${id} joined rooms`);
        
        await prisma.driver.update({
          where: { id: id },
          data: { isOnline: true },
        });
      } catch (err) {
        console.error('Error in driver:register:', err);
      }
    });

    socket.on('driver:update_location', async (data) => {
      try {
        const { driverId, lat, lng } = data;
        const id = parseInt(driverId);
        if (isNaN(id)) return;

        await prisma.driver.update({
          where: { id: id },
          data: { currentLat: lat, currentLng: lng, lastLocationAt: new Date() },
        });

        // Lưu lịch sử vị trí vào bảng DriverLocationHistory
        await prisma.driverLocationHistory.create({
          data: {
            driverId: id,
            lat: lat,
            lng: lng,
          },
        });

        io.emit('driver:location_changed', { driverId: id, lat, lng });
      } catch (err) {
        console.error('Error in driver:update_location:', err);
      }
    });

    // ==========================================
    // --- XỬ LÝ CHUYẾN ĐI (SEQUENTIAL FLOW) ---
    // ==========================================

    const notifyNextDriver = async (requestId) => {
      const pending = pendingTrips.get(requestId);
      if (!pending) return;

      // 1. Nếu đã hết danh sách tài xế
      if (pending.currentIndex >= pending.driverIds.length) {
        console.log(`[TRIP] No more drivers for request ${requestId}`);
        io.to(pending.customerSocketId).emit('trip:no_driver_found', { requestId });
        pendingTrips.delete(requestId);
        return;
      }

      const driverId = pending.driverIds[pending.currentIndex];
      pending.currentIndex++;
      pendingTrips.set(requestId, pending);

      console.log(`[TRIP] Notifying driver ${driverId} for request ${requestId}`);

      // 2. Gửi yêu cầu tới tài xế
      io.to(`driver_${driverId}`).emit('trip:new_request', {
        requestId,
        ...pending.data
      });

      // 3. Đặt timeout 10 giây
      pending.timeout = setTimeout(() => {
        console.log(`[TRIP] Driver ${driverId} timed out for request ${requestId}`);
        notifyNextDriver(requestId);
      }, 10000); 
    };

    socket.on('trip:request', async (data) => {
      try {
        const { 
          passengerId, 
          driverIds, // Mảng các driverId gần đó
          ...tripData 
        } = data;

        if (!driverIds || driverIds.length === 0) {
          socket.emit('trip:error', { message: 'Không tìm thấy tài xế gần đây' });
          return;
        }

        const requestId = `req_${Date.now()}_${passengerId}`;
        
        // Lấy thông tin khách hàng (để hiển thị cho tài xế)
        const user = await prisma.user.findUnique({
          where: { id: parseInt(passengerId) },
          select: { fullName: true, phone: true, avatarUrl: true }
        });

        pendingTrips.set(requestId, {
          data: {
            ...tripData,
            passengerName: user.fullName,
            passengerAvatar: user.avatarUrl,
            passengerPhone: user.phone,
            passengerId: parseInt(passengerId)
          },
          driverIds,
          currentIndex: 0,
          timeout: null,
          customerSocketId: socket.id
        });

        console.log(`[TRIP] New sequential request ${requestId} for ${driverIds.length} drivers`);
        
        notifyNextDriver(requestId);
        socket.emit('trip:request_sent', { requestId });

      } catch (error) {
        console.error('[TRIP ERROR] Request error:', error);
        socket.emit('trip:error', { message: 'Lỗi hệ thống khi gửi yêu cầu' });
      }
    });

    socket.on('trip:decline', (data) => {
      const { requestId } = data;
      const pending = pendingTrips.get(requestId);
      if (pending) {
        console.log(`[TRIP] Driver declined request ${requestId}. Moving to next...`);
        clearTimeout(pending.timeout);
        notifyNextDriver(requestId);
      }
    });

    socket.on('trip:accept', async (data) => {
      try {
        const { requestId, driverId } = data;
        const pending = pendingTrips.get(requestId);
        
        if (!pending) {
          socket.emit('trip:error', { message: 'Yêu cầu này không còn tồn tại hoặc đã hết hạn' });
          return;
        }

        // 1. Dừng timeout
        clearTimeout(pending.timeout);

        // 2. Tìm hoặc tạo Customer
        let customer = await prisma.customer.findUnique({
          where: { userId: pending.data.passengerId }
        });
        if (!customer) {
          customer = await prisma.customer.create({
            data: { userId: pending.data.passengerId }
          });
        }

        // 3. TỐI ƯU HÓA: Sử dụng interactive transaction để thực hiện tất cả các bước trong một lần gửi tới DB
        const result = await prisma.$transaction(async (tx) => {
          const trip = await tx.trip.create({
            data: {
              customerId: customer.id,
              driverId: parseInt(driverId),
              pickupAddress: pending.data.pickupAddress,
              pickupLat: parseFloat(pending.data.pickupLat),
              pickupLng: parseFloat(pending.data.pickupLng),
              dropoffAddress: pending.data.dropoffAddress,
              dropoffLat: parseFloat(pending.data.dropoffLat),
              dropoffLng: parseFloat(pending.data.dropoffLng),
              distanceKm: parseFloat(pending.data.distance),
              durationEstimateMin: parseInt(pending.data.duration),
              priceEstimate: parseFloat(pending.data.price),
              routePolyline: pending.data.routePolyline,
              vehicleId: pending.data.vehicleId ? parseInt(pending.data.vehicleId) : null,
              status: 'accepted',
            },
            include: {
              driver: { include: { user: true } }
            }
          });

          const paymentMethod = pending.data.paymentMethod || 'CASH';
          const discountAmount = pending.data.discountAmount || 0;
          const finalPrice = Math.max(0, (parseFloat(pending.data.price) - discountAmount));

          if (paymentMethod === 'WALLET') {
            const wallet = await tx.wallet.findUnique({
              where: { userId: pending.data.passengerId }
            });

            if (!wallet || wallet.balance < finalPrice) {
              throw new Error('WALLET_INSUFFICIENT_FUNDS');
            }

            await tx.wallet.update({
              where: { id: wallet.id },
              data: { balance: { decrement: finalPrice } }
            });

            await tx.walletTransaction.create({
              data: {
                walletId: wallet.id,
                type: 'debit',
                amount: finalPrice,
                description: `Thanh toán chuyến đi #${trip.id} (Giữ tiền)`,
                reference: `trip_${trip.id}`
              }
            });

            await tx.payment.create({
              data: {
                tripId: trip.id,
                method: paymentMethod,
                amount: finalPrice,
                status: 'success'
              }
            });
          } else {
            await tx.payment.create({
              data: {
                tripId: trip.id,
                method: paymentMethod,
                amount: finalPrice,
                status: 'pending'
              }
            });
          }

          if (pending.data.voucherId) {
            await tx.voucherUsage.create({
              data: {
                voucherId: pending.data.voucherId,
                userId: pending.data.passengerId,
                tripId: trip.id,
                discountAmount: discountAmount
              }
            });
            
            await tx.voucher.update({
              where: { id: pending.data.voucherId },
              data: { usedCount: { increment: 1 } }
            });
          }

          return { trip, finalPrice };
        }, { timeout: 15000 });

        const { trip: newTrip, finalPrice } = result;
        
        // EMIT NGAY LẬP TỨC CHO TÀI XẾ ĐỂ CHUYỂN GIAO DIỆN
        socket.emit('trip:accept_success', { 
          tripId: newTrip.id,
          trip: newTrip 
        });

        socket.join(`trip_${newTrip.id}`);

        // 5. Thông báo cho các bên
        io.to(pending.customerSocketId).emit('trip:accepted', {
          tripId: newTrip.id,
          driverName: newTrip.driver.user.fullName,
          driverPhone: newTrip.driver.user.phone,
          vehiclePlate: "43A-123.45" 
        });

        // Thông báo số dư mới cho khách nếu dùng ví
        if (pending.data.paymentMethod === 'WALLET') {
          io.to(`user_${pending.data.passengerId}`).emit('wallet:updated', { 
            reason: 'escrow_hold' 
          });
        }

        // 6. Xóa khỏi pending
        pendingTrips.delete(requestId);

      } catch (error) {
        console.error('[TRIP ERROR] Accept error:', error);
        if (error.message === 'WALLET_INSUFFICIENT_FUNDS') {
          socket.emit('trip:error', { message: 'Số dư ví khách hàng không đủ' });
        } else {
          socket.emit('trip:error', { message: 'Lỗi khi chấp nhận chuyến đi' });
        }
      }
    });

    // Tham gia phòng để theo dõi chuyến đi cụ thể
    socket.on('trip:join', (tripId) => {
      socket.join(`trip_${tripId}`);
      console.log(`Socket ${socket.id} joined trip_${tripId}`);
    });

    // Cập nhật trạng thái chuyến đi (Tài xế gọi)
    socket.on('trip:update_status', async (data) => {
      try {
        const { tripId, status } = data;
        
        await prisma.$transaction(async (tx) => {
          const trip = await tx.trip.findUnique({
            where: { id: parseInt(tripId) },
            include: { 
              driver: true, 
              customer: { include: { user: true } },
              payments: true
            }
          });

          if (!trip || (status === 'completed' && trip.status === 'completed')) return;

          let finalPrice = trip.priceEstimate || 0;

          if (status === 'completed') {
            await tx.payment.updateMany({
              where: { tripId: trip.id, status: 'pending' },
              data: { status: 'success', paidAt: new Date() }
            });
            
            const [policyResult, driverWalletResult] = await Promise.all([
              tx.commissionPolicy.findFirst({ where: { isActive: true } }),
              tx.wallet.findUnique({ where: { userId: trip.driver.userId } })
            ]);

            let policy = policyResult || await tx.commissionPolicy.create({
              data: { name: 'Mặc định 20%', ratePercent: 20, effectiveFrom: new Date() }
            });

            let driverWallet = driverWalletResult || await tx.wallet.create({ 
              data: { userId: trip.driver.userId, balance: 0 } 
            });

            const commissionAmount = finalPrice * (policy.ratePercent / 100);
            const driverIncome = finalPrice - commissionAmount;

            if (trip.payments[0]?.method === 'WALLET') {
              await tx.wallet.update({
                where: { id: driverWallet.id },
                data: { balance: { increment: driverIncome } }
              });

              await tx.walletTransaction.create({
                data: {
                  walletId: driverWallet.id,
                  type: 'credit',
                  amount: driverIncome,
                  description: `Thu nhập chuyến đi #${trip.id}`,
                  reference: `trip_${trip.id}`
                }
              });

              io.to(`driver_${trip.driver.userId}`).emit('wallet:updated', { reason: 'trip_payout' });
              io.to(`user_${trip.customer.userId}`).emit('wallet:updated', { reason: 'trip_completed' });
            }

            await tx.tripCommission.create({
              data: {
                tripId: trip.id,
                driverId: trip.driver.id,
                commissionPolicyId: policy.id,
                commissionAmount: commissionAmount
              }
            });

            await tx.wallet.update({
              where: { id: driverWallet.id },
              data: { balance: { decrement: commissionAmount } }
            });

            await tx.walletTransaction.create({
              data: {
                walletId: driverWallet.id,
                type: 'commission',
                amount: commissionAmount,
                description: `Thu phí hoa hồng chuyến đi #${trip.id}`
              }
            });
          }

          await tx.trip.update({
            where: { id: parseInt(tripId) },
            data: { 
              status: status,
              ...(status === 'completed' ? { finalPrice: finalPrice } : {})
            }
          });

          if (status === 'completed' || status === 'cancelled') {
            await tx.driver.update({
              where: { id: trip.driverId },
              data: { isBusy: false }
            });

            // Tự động cập nhật số chuyến và hạng tài xế khi hoàn thành
            if (status === 'completed') {
              const rankResult = await authAdminService.updateDriverRankAfterTrip(trip.driverId);
              if (rankResult.upgraded) {
                // Thông báo nâng hạng cho tài xế qua socket
                io.to(`driver_${trip.driverId}`).emit('driver:rank_upgraded', {
                  oldRank: rankResult.oldRank,
                  newRank: rankResult.newRank,
                  message: `Chúc mừng! Bạn đã được nâng cấp lên hạng ${rankResult.newRank}`
                });
              }
            }
          }
        }, { timeout: 15000 });

        io.to(`trip_${tripId}`).emit('trip:status_updated', { tripId, status });
        
      } catch (error) {
        console.error('[TRIP ERROR] Update status error:', error);
      }
    });

    // Driver: Phát vị trí cho passenger trong chuyến đi
    socket.on('trip:location_update', async (data) => {
      const { tripId, lat, lng, driverId } = data;
      // Chỉ phát cho những người đang theo dõi chuyến đi này
      socket.to(`trip_${tripId}`).emit('driver:location_changed', { lat, lng });

      // Lưu lịch sử vị trí gắn với tripId
      if (driverId) {
        try {
          await prisma.driverLocationHistory.create({
            data: {
              driverId: parseInt(driverId),
              tripId: parseInt(tripId),
              lat: lat,
              lng: lng,
            },
          });
        } catch (err) {
          console.error('Error saving trip location history:', err);
        }
      }
    });

    socket.on('disconnect', () => {
      console.log(`Socket disconnected: ${socket.id}`);
    });
  });

  return io;
};

export const getIO = () => {
  if (!io) {
    throw new Error('Socket.io not initialized');
  }
  return io;
};
