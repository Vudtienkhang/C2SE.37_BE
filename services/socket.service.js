import { Server } from 'socket.io';
import prisma from '../prisma/prisma.js';
import redis from '../lib/redis.js';
import { tripTasksQueue } from '../lib/queue.js';
import * as authAdminService from './admin.service.js';
import * as pricingService from './pricing.service.js';

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
        console.log(`[SOCKET] Driver ${id} registration received`);

        // TỐI ƯU: Thử update theo ID trước, nếu không tìm thấy thì thử theo userId
        // Điều này giúp tương thích với cả Frontend cũ (gửi userId) và mới (gửi driverId)
        try {
          const updated = await prisma.driver.update({
            where: { id: id },
            data: { isOnline: true },
          });
          console.log(`[SOCKET] Driver registered by ID: ${updated.id}`);
        } catch (updateErr) {
          if (updateErr.code === 'P2025') {
            // Thử theo userId
            const updated = await prisma.driver.update({
              where: { userId: id },
              data: { isOnline: true },
            });
            console.log(`[SOCKET] Driver registered by UserID: ${updated.id}`);
          } else {
            throw updateErr;
          }
        }
      } catch (err) {
        console.error('Error in driver:register:', err);
      }
    });

    socket.on('driver:update_location', async (data) => {
      try {
        const { driverId, lat, lng } = data;
        const id = parseInt(driverId);
        if (isNaN(id)) return;

        // TÌM TÀI XẾ (Đảm bảo dùng đúng Driver ID cho Redis)
        let actualDriverId = id;
        const driver = await prisma.driver.findUnique({ 
          where: { id: id },
          select: { id: true }
        });
        
        if (!driver) {
          const driverByUser = await prisma.driver.findUnique({ 
            where: { userId: id },
            select: { id: true }
          });
          if (driverByUser) {
            actualDriverId = driverByUser.id;
          } else {
            console.warn(`[SOCKET] Location update ignored: Driver not found for ID or UserID ${id}`);
            return;
          }
        }

        // 1. TỐI ƯU: Lưu vào Redis (Geospatial Index) 
        await redis.geoadd('drivers:locations', lng, lat, actualDriverId);
        
        // Cập nhật trạng thái vào Redis
        await redis.set(`driver:${actualDriverId}:last_location`, JSON.stringify({ lat, lng, time: new Date() }));

        io.emit('driver:location_changed', { driverId: actualDriverId, lat, lng });
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
          driverIds: rawDriverIds,
          pickupLat,
          pickupLng,
          distance,
          duration,
          vehicleType,
          ...tripData 
        } = data;

        // 1. NGĂN CHẶN TRÙNG LẶP
        const driverIds = [...new Set(rawDriverIds)];

        // 2. KIỂM TRA REQUEST ĐANG CHỜ
        for (const [id, pending] of pendingTrips.entries()) {
          if (pending.data.passengerId === parseInt(passengerId)) {
            socket.emit('trip:error', { message: 'Bạn đang có một yêu cầu tìm tài xế đang xử lý' });
            return;
          }
        }

        if (!driverIds || driverIds.length === 0) {
          socket.emit('trip:error', { message: 'Không tìm thấy tài xế gần đây' });
          return;
        }

        // 3. TÍNH TOÁN GIÁ CHÍNH XÁC VÀ BREAKDOWN (MỚI)
        const priceBreakdown = await pricingService.calculateTripPrice({
          distanceKm: parseFloat(distance),
          durationMin: parseFloat(duration),
          vehicleType,
          pickupLat: parseFloat(pickupLat),
          pickupLng: parseFloat(pickupLng)
        });

        const requestId = `req_${Date.now()}_${passengerId}`;
        
        // Lấy thông tin khách hàng
        const user = await prisma.user.findUnique({
          where: { id: parseInt(passengerId) },
          select: { fullName: true, phone: true, avatarUrl: true }
        });

        pendingTrips.set(requestId, {
          data: {
            ...tripData,
            ...priceBreakdown, // Bao gồm baseFare, surchargeBreakdown, systemFee, totalPrice
            distance: parseFloat(distance),
            duration: parseInt(duration),
            vehicleType,
            pickupLat,
            pickupLng,
            passengerName: user.fullName,
            passengerAvatar: user.avatarUrl,
            passengerPhone: user.phone,
            passengerId: parseInt(passengerId),
            price: priceBreakdown.totalPrice // Ghi đè giá từ FE gửi lên bằng giá tính toán chính xác
          },
          driverIds,
          currentIndex: 0,
          timeout: null,
          customerSocketId: socket.id
        });

        console.log(`[TRIP] New request ${requestId} with calculated price ${priceBreakdown.totalPrice}`);
        
        notifyNextDriver(requestId);
        socket.emit('trip:request_sent', { requestId, price: priceBreakdown.totalPrice });

      } catch (error) {
        console.error('[TRIP ERROR] Request error:', error);
        socket.emit('trip:error', { message: 'Lỗi hệ thống khi tính giá hoặc gửi yêu cầu' });
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

        // 3. TRANSACTION RÚT GỌN: Chỉ thực hiện những bước bắt buộc để khởi tạo Trip
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
              conversation: { create: {} },
              // Lưu Breakdown vào TripFeeBreakdown
              feeBreakdowns: {
                create: [
                   { feeType: 'base_fare', amount: pending.data.baseFare },
                   { feeType: 'surcharge_night', amount: pending.data.surchargeBreakdown.night },
                   { feeType: 'surcharge_rush_hour', amount: pending.data.surchargeBreakdown.rushHour },
                   { feeType: 'surcharge_holiday', amount: pending.data.surchargeBreakdown.holiday },
                   { feeType: 'surcharge_weather', amount: pending.data.surchargeBreakdown.weather },
                   { feeType: 'system_fee', amount: pending.data.systemFee },
                ]
              }
            },
            include: {
              driver: { include: { user: true } }
            }
          });
          await tx.driver.update({
            where: { id: parseInt(driverId) },
            data: { isBusy: true }
          });
          return trip;
        });


        const trip = result;
        const discountAmount = pending.data.discountAmount || 0;
        const finalPrice = Math.max(0, (parseFloat(pending.data.price) - discountAmount));

        // 4. ĐẨY CÁC TÁC VỤ PHỤ VÀO QUEUE (Thanh toán, Voucher)
        await tripTasksQueue.add('PROCESS_TRIP_ACCEPTANCE', {
          tripId: trip.id,
          passengerId: pending.data.passengerId,
          paymentMethod: pending.data.paymentMethod || 'CASH',
          finalPrice: finalPrice,
          voucherId: pending.data.voucherId,
          discountAmount: discountAmount
        });

        // EMIT NGAY LẬP TỨC CHO TÀI XẾ ĐỂ CHUYỂN GIAO DIỆN
        socket.emit('trip:accept_success', { 
          tripId: trip.id,
          trip: trip 
        });

        socket.join(`trip_${trip.id}`);

        // 5. Thông báo cho các bên
        io.to(pending.customerSocketId).emit('trip:accepted', {
          tripId: trip.id,
          driverName: trip.driver.user.fullName,
          driverPhone: trip.driver.user.phone,
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
        const { tripId, status, cancelledBy, cancelReason } = data;
        console.log(`[SOCKET] Received trip:update_status: ${status} for Trip #${tripId}`);
        
        // 1. CỘP NHẬT TRẠNG THÁI TRONG DB CHÍNH (CRITICAL)
        const trip = await prisma.trip.update({
          where: { id: parseInt(tripId) },
          data: { 
            status: status,
            ...(status === 'completed' ? { finalPrice: data.finalPrice || undefined } : {}),
            ...(status === 'cancelled' && cancelledBy ? { cancelledBy } : {}),
            ...(status === 'cancelled' && cancelReason ? { cancelReason } : {})
          },
          include: { 
            driver: true,
            payments: true 
          }
        });

        // 2. NẾU HOÀN THÀNH, ĐẨY CÁC TÁC VỤ HOA HỒNG/VÍ/XẾP HẠNG VÀO QUEUE
        if (status === 'completed') {
          console.log(`[SOCKET] Trip #${tripId} COMPLETED. Adding worker job...`);
          await tripTasksQueue.add('PROCESS_TRIP_COMPLETION', {
            tripId: trip.id,
            driverId: trip.driverId,
            finalPrice: trip.finalPrice || trip.priceEstimate,
            paymentMethod: trip.payments[0]?.method || data.paymentMethod || 'CASH' 
          });
          console.log(`[SOCKET] Job for Trip #${tripId} added to Queue successfully.`);

          if (trip.driverId) {
            await prisma.driver.update({
              where: { id: trip.driverId },
              data: { isBusy: false }
            });
          }
        }

        if (status === 'cancelled') {
          console.log(`[SOCKET] Trip #${tripId} CANCELLED by ${cancelledBy || 'unknown'}. Adding worker job...`);
          await tripTasksQueue.add('PROCESS_TRIP_CANCELLATION', {
            tripId: trip.id,
            driverId: trip.driverId,
            cancelledBy: cancelledBy || 'driver' // Mặc định driver nếu app cũ chưa gửi lên
          });
          
          if (trip.driverId) {
            await prisma.driver.update({
              where: { id: trip.driverId },
              data: { isBusy: false }
            });
          }
        }

        // 3. THÔNG BÁO CHO CÁC BÊN NGAY LẬP TỨC
        console.log(`[SOCKET] Emitting trip:status_updated for Trip #${tripId} with status: ${status}`);
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

    // ==========================================
    // --- XỬ LÝ CHAT ---
    // ==========================================

    socket.on('chat:join', (data) => {
      const { tripId } = data;
      socket.join(`chat_${tripId}`);
      console.log(`Socket ${socket.id} joined chat room for trip ${tripId}`);
    });

    socket.on('chat:send_message', async (data) => {
      try {
        const { tripId, senderId, content, messageType = 'text', fileUrl } = data;
        
        // 1. Tìm conversation của trip
        const conversation = await prisma.conversation.findUnique({
          where: { tripId: parseInt(tripId) }
        });

        if (!conversation) {
          console.error(`[CHAT ERROR] Conversation not found for trip ${tripId}`);
          return;
        }

        // 2. Lưu message vào DB
        const message = await prisma.message.create({
          data: {
            conversationId: conversation.id,
            senderId: parseInt(senderId),
            content: content,
            messageType: messageType,
            fileUrl: fileUrl || null,
          },
          include: {
            sender: {
              select: {
                fullName: true,
                avatarUrl: true
              }
            }
          }
        });

        // 3. Broadcast tới các bên trong trip
        // Gửi qua room trip_ để những người đang ở màn hình tracking nhận được badge
        io.to(`trip_${tripId}`).emit('chat:receive_message', message);
        
        // Gửi qua room chat_ (nếu có tách biệt)
        io.to(`chat_${tripId}`).emit('chat:new_message', message);

      } catch (error) {
        console.error('[CHAT ERROR] Send message error:', error);
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

export const emitToUser = (userId, event, data) => {
  if (!io) return;
  // Gửi cả vào room user_ và driver_ để đảm bảo nhận được
  io.to(`user_${userId}`).emit(event, data);
  io.to(`driver_${userId}`).emit(event, data);
};
