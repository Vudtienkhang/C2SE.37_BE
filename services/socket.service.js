import { Server } from 'socket.io';
import prisma from '../prisma/prisma.js';
import redis from '../lib/redis.js';
import { getConfig } from './config.service.js';
import * as pricingService from './pricing.service.js';
import { tripTasksQueue } from '../lib/queue.js';
import logger from '../lib/logger.js';

let io;
const pendingTrips = new Map(); // requestId -> { data, driverIds, currentIndex, timeout, customerSocketId }

export const initSocket = (server) => {
  io = new Server(server, {
    cors: {
      origin: '*', 
      methods: ['GET', 'POST'],
    },
  });

  logger.info('Socket.io initialized');

  io.on('connection', (socket) => {
    socket.on('user:register', (userId) => {
      socket.join(`user_${userId}`);
      logger.debug(`User ${userId} joined their private room`);
    });

    socket.on('driver:register', async (driverId) => {
      try {
        const id = parseInt(driverId);
        if (isNaN(id)) return;

        // 1. KIỂM TRA TRẠNG THÁI TÀI XẾ (Bảo mật)
        const driver = await prisma.driver.findFirst({
          where: { 
            OR: [
              { id: id },
              { userId: id }
            ]
          }
        });

        if (!driver || driver.status !== 'approved') {
          logger.warn({ driverId: id, status: driver?.status }, '[SOCKET] Driver registration rejected');
          socket.emit('driver:error', { message: 'Tài khoản của bạn chưa được duyệt hoặc bị khóa.' });
          return;
        }

        const actualDriverId = driver.id;
        socket.driverId = actualDriverId; // Lưu vào socket để dùng khi disconnect
        socket.join(`driver_${actualDriverId}`);
        socket.join('drivers');
        
        await prisma.driver.update({
          where: { id: actualDriverId },
          data: { isOnline: true },
        });

        logger.info({ driverId: actualDriverId }, '[SOCKET] Driver registered and online');
      } catch (err) {
        logger.error(err, 'Error in driver:register');
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
            logger.warn({ id }, '[SOCKET] Location update ignored: Driver not found');
            return;
          }
        }

        // 1. TỐI ƯU: Lưu vào Redis (Geospatial Index) 
        await redis.geoadd('drivers:locations', lng, lat, actualDriverId);
        
        // Cập nhật trạng thái vào Redis
        await redis.set(`driver:${actualDriverId}:last_location`, JSON.stringify({ lat, lng, time: new Date() }));

        io.emit('driver:location_changed', { driverId: actualDriverId, lat, lng });
      } catch (err) {
        logger.error(err, 'Error in driver:update_location');
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
        logger.info({ requestId }, '[TRIP] No more drivers for request');
        io.to(pending.customerSocketId).emit('trip:no_driver_found', { requestId });
        pendingTrips.delete(requestId);
        return;
      }

      const driverId = pending.driverIds[pending.currentIndex];
      pending.currentIndex++;
      pendingTrips.set(requestId, pending);

      logger.info({ driverId, requestId }, '[TRIP] Notifying driver for request');

      // 2. Gửi yêu cầu tới tài xế
      io.to(`driver_${driverId}`).emit('trip:new_request', {
        requestId,
        ...pending.data
      });

      // 3. Đặt timeout 10 giây
      pending.timeout = setTimeout(() => {
        logger.info({ driverId, requestId }, '[TRIP] Driver timed out for request');
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

        // 3. XÁC THỰC KHOẢNG CÁCH VÀ SẮP XẾP ƯU TIÊN THEO HẠNG (DATABASE-DRIVEN)
        // 3.1. Lấy hệ số ưu tiên từ Database
        const rankPriorities = await getConfig('DRIVER_RANK_PRIORITY', {
          SILVER: 1.0,
          GOLD: 1.1,
          PLATINUM: 1.25,
          DIAMOND: 1.5
        });

        // 3.2. Lấy thông tin tài xế để tính khoảng cách hiệu dụng
        const driversData = await prisma.driver.findMany({
          where: { id: { in: driverIds } },
          include: { DriverRank: true }
        });

        // 3.3. Tính toán và sắp xếp lại driverIds dựa trên công thức: EffectiveDistance = ActualDistance / Multiplier
        const sortedDrivers = await Promise.all(driverIds.map(async (dId) => {
          const driver = driversData.find(d => d.id === dId);
          if (!driver) return null;

          // Lấy vị trí thực tế của tài xế từ Redis
          const locStr = await redis.get(`driver:${dId}:last_location`);
          let actualDist = 999; // Mặc định rất xa nếu không tìm thấy vị trí
          
          if (locStr) {
            const loc = JSON.parse(locStr);
            // Hàm tính Haversine cơ bản
            const calculateHaversine = (lat1, lon1, lat2, lon2) => {
              const R = 6371;
              const dLat = (lat2 - lat1) * (Math.PI / 180);
              const dLon = (lon2 - lon1) * (Math.PI / 180);
              const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                        Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) * 
                        Math.sin(dLon / 2) * Math.sin(dLon / 2);
              const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
              return R * c;
            };
            actualDist = calculateHaversine(parseFloat(pickupLat), parseFloat(pickupLng), loc.lat, loc.lng);
          }

          const multiplier = rankPriorities[driver.DriverRank?.code] || 1.0;
          return {
            id: dId,
            effectiveDistance: actualDist / multiplier
          };
        }));

        // Lọc bỏ null và sắp xếp theo khoảng cách hiệu dụng tăng dần
        const finalizedDriverIds = sortedDrivers
          .filter(d => d !== null)
          .sort((a, b) => a.effectiveDistance - b.effectiveDistance)
          .map(d => d.id);

        logger.info({ 
          originalCount: driverIds.length, 
          finalCount: finalizedDriverIds.length 
        }, '[PRIORITY] Drivers re-sorted for Request');

        if (finalizedDriverIds.length === 0) {
          socket.emit('trip:error', { message: 'Không tìm thấy tài xế khả dụng để điều phối' });
          return;
        }

        // 4. TÍNH TOÁN GIÁ CHÍNH XÁC VÀ BREAKDOWN (MỚI)
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
          driverIds: finalizedDriverIds, // Dùng danh sách đã được sắp xếp ưu tiên tại Backend
          currentIndex: 0,
          timeout: null,
          customerSocketId: socket.id
        });

        logger.info({ requestId, firstDriver: finalizedDriverIds[0] }, '[TRIP] New request with re-sorted drivers');
        
        notifyNextDriver(requestId);
        socket.emit('trip:request_sent', { requestId, price: priceBreakdown.totalPrice });

      } catch (error) {
        logger.error(error, '[TRIP ERROR] Request error');
        socket.emit('trip:error', { message: 'Lỗi hệ thống khi tính giá hoặc gửi yêu cầu' });
      }
    });


    socket.on('trip:decline', (data) => {
      const { requestId } = data;
      const pending = pendingTrips.get(requestId);
      if (pending) {
        logger.info({ requestId }, '[TRIP] Driver declined request. Moving to next...');
        clearTimeout(pending.timeout);
        notifyNextDriver(requestId);
      }
    });

    socket.on('trip:accept', async (data) => {
      try {
        const { requestId, driverId } = data;
        
        // --- 1. GIẢI QUYẾT RACE CONDITION (CRITICAL) ---
        // Lấy và xóa ngay lập tức khỏi Map để ngăn chặn driver khác nhận cùng lúc
        const pending = pendingTrips.get(requestId);
        
        if (!pending) {
          socket.emit('trip:error', { message: 'Yêu cầu này không còn tồn tại hoặc đã được tài xế khác nhận.' });
          return;
        }

        // --- 2. XÁC THỰC VÍ KHÁCH HÀNG (TRƯỚC KHI TẠO TRIP) ---
        const discountAmount = pending.data.discountAmount || 0;
        const finalPrice = Math.max(0, (parseFloat(pending.data.price) - discountAmount));

        if (pending.data.paymentMethod === 'WALLET') {
          const customerWallet = await prisma.wallet.findUnique({
            where: { userId: pending.data.passengerId }
          });
          
          if (!customerWallet || customerWallet.balance < finalPrice) {
            // Trả lại Map nếu lỗi (để khách hàng có thể thử lại hoặc driver khác không bị khóa vĩnh viễn)
            // Tuy nhiên thường thì nên hủy request này luôn vì khách không đủ tiền
            logger.warn({ passengerId: pending.data.passengerId, balance: customerWallet?.balance, finalPrice }, '[WALLET GUARD] Insufficient balance');
            socket.emit('trip:error', { message: 'Số dư ví khách hàng không đủ để thực hiện chuyến đi này.' });
            
            // Thông báo cho khách hàng
            io.to(pending.customerSocketId).emit('trip:error', { message: 'Số dư ví không đủ. Vui lòng nạp thêm tiền hoặc đổi phương thức thanh toán.' });
            pendingTrips.delete(requestId); // Hủy luôn request vì không thanh toán được
            return;
          }
        }

        // Xóa khỏi Map sau khi qua được các bước validate để tài xế khác không nhận được nữa
        pendingTrips.delete(requestId);

        // 3. Dừng timeout
        clearTimeout(pending.timeout);

        // 4. Tìm hoặc tạo Customer
        let customer = await prisma.customer.findUnique({
          where: { userId: pending.data.passengerId }
        });
        if (!customer) {
          customer = await prisma.customer.create({
            data: { userId: pending.data.passengerId }
          });
        }

        // 5. TRANSACTION: Khởi tạo Trip
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

        // 6. ĐẨY CÁC TÁC VỤ PHỤ VÀO QUEUE (Tính toán tiền thực tế, Voucher...)
        await tripTasksQueue.add('PROCESS_TRIP_ACCEPTANCE', {
          tripId: trip.id,
          passengerId: pending.data.passengerId,
          paymentMethod: pending.data.paymentMethod || 'CASH',
          finalPrice: finalPrice,
          voucherId: pending.data.voucherId,
          discountAmount: discountAmount
        });

        // EMIT NGAY LẬP TỨC CHO TÀI XẾ
        socket.emit('trip:accept_success', { 
          tripId: trip.id,
          trip: trip 
        });

        socket.join(`trip_${trip.id}`);

        // 7. Thông báo cho khách
        io.to(pending.customerSocketId).emit('trip:accepted', {
          tripId: trip.id,
          driverName: trip.driver.user.fullName,
          driverPhone: trip.driver.user.phone,
          vehiclePlate: "43A-123.45" 
        });

        if (pending.data.paymentMethod === 'WALLET') {
          io.to(`user_${pending.data.passengerId}`).emit('wallet:updated', { 
            reason: 'escrow_hold' 
          });
        }

        // 8. BROADCAST TO ADMINS
        io.emit('admin:trip_updated', { tripId: trip.id, type: 'new_trip' });

      } catch (error) {
        logger.error(error, '[TRIP ERROR] Accept error');
        socket.emit('trip:error', { message: 'Lỗi khi chấp nhận chuyến đi' });
      }
    });

    // Tham gia phòng để theo dõi chuyến đi cụ thể
    socket.on('trip:join', (tripId) => {
      socket.join(`trip_${tripId}`);
      logger.debug({ socketId: socket.id, tripId }, 'Socket joined trip room');
    });

    // Cập nhật trạng thái chuyến đi (Tài xế gọi)
    socket.on('trip:update_status', async (data) => {
      try {
        const { tripId, status, cancelledBy, cancelReason } = data;
        logger.info({ tripId, status }, '[SOCKET] Received trip:update_status');
        
        // 1. KIỂM TRA TRẠNG THÁI HIỆN TẠI (CRITICAL)
        const currentTrip = await prisma.trip.findUnique({
          where: { id: parseInt(tripId) },
          select: { status: true, driverId: true }
        });

        if (!currentTrip) {
          logger.error({ tripId }, '[SOCKET ERROR] Trip not found');
          return;
        }

        // Nếu đã hoàn thành hoặc đã hủy thì không cho cập nhật nữa
        if (currentTrip.status === 'completed' || currentTrip.status === 'cancelled') {
          logger.warn({ tripId, status: currentTrip.status, newStatus: status }, '[SOCKET WARN] Trip already finalized. Ignoring update.');
          return;
        }

        // Định nghĩa các bước chuyển trạng thái hợp lệ
        const validTransitions = {
          'requested': ['accepted', 'cancelled'],
          'accepted': ['arrived', 'cancelled'],
          'arrived': ['started', 'cancelled'],
          'started': ['completed', 'cancelled']
        };

        if (validTransitions[currentTrip.status] && !validTransitions[currentTrip.status].includes(status)) {
          logger.warn({ tripId, from: currentTrip.status, to: status }, '[SOCKET WARN] Invalid status transition');
          return;
        }

        // 2. CỘP NHẬT TRẠNG THÁI TRONG DB CHÍNH
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
          logger.info({ tripId }, '[SOCKET] Trip COMPLETED. Adding worker job...');
          await tripTasksQueue.add('PROCESS_TRIP_COMPLETION', {
            tripId: trip.id,
            driverId: trip.driverId,
            finalPrice: trip.finalPrice || trip.priceEstimate,
            paymentMethod: trip.payments[0]?.method || data.paymentMethod || 'CASH' 
          });
          logger.info({ tripId }, '[SOCKET] Job added to Queue successfully');

          if (trip.driverId) {
            await prisma.driver.update({
              where: { id: trip.driverId },
              data: { isBusy: false }
            });
          }
        }

        if (status === 'cancelled') {
          logger.info({ tripId, cancelledBy }, '[SOCKET] Trip CANCELLED. Adding worker job...');
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
        logger.debug({ tripId, status }, '[SOCKET] Emitting trip:status_updated');
        io.to(`trip_${tripId}`).emit('trip:status_updated', { tripId, status });
        
        // Broadcast to admins for list update
        io.emit('admin:trip_updated', { tripId, status, type: 'status_update' });
        
      } catch (error) {
        logger.error(error, '[TRIP ERROR] Update status error');
        socket.emit('trip:error', { message: 'Lỗi hệ thống khi cập nhật trạng thái. Vui lòng kiểm tra kết nối.' });
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
          logger.error(err, 'Error saving trip location history');
        }
      }
    });

    // ==========================================
    // --- XỬ LÝ SỰ KIỆN KHẨN CẤP (SOS) ---
    // ==========================================
    socket.on('trip:sos', async (data) => {
      try {
        const { tripId, callerRole, callerId, lat, lng } = data;
        logger.warn({ tripId, callerRole }, '[SOS ALERT] Signal received');

        let newAlert = null;
        // 1. TRY TO SAVE TO DATABASE (PERSISTENCE)
        try {
          newAlert = await prisma.sOSAlert.create({
            data: {
              tripId: parseInt(tripId),
              callerId: parseInt(callerId),
              callerRole,
              lat: lat ? parseFloat(lat) : null,
              lng: lng ? parseFloat(lng) : null,
              status: 'active'
            },
            include: {
              trip: {
                include: {
                  customer: { include: { user: true } },
                  driver: { include: { user: true } },
                  vehicle: true
                }
              }
            }
          });
          logger.warn({ alertId: newAlert.id }, '[SOS ALERT] Persistent signal saved');
        } catch (dbErr) {
          logger.error(dbErr, '[SOS DB ERROR] Failed to save alert to DB');
          // Fallback if DB save fails: Try to fetch trip info manually to send broadcast
          try {
            const trip = await prisma.trip.findUnique({
              where: { id: parseInt(tripId) },
              include: {
                customer: { include: { user: true } },
                driver: { include: { user: true } },
                vehicle: true
              }
            });
            if (trip) {
               newAlert = { trip, createdAt: new Date() }; // Mock object for broadcast
            }
          } catch (tripErr) { 
             logger.error(tripErr, '[SOS] Also failed to fetch trip info');
          }
        }

        // 2. CONSTRUCT PAYLOAD
        if (newAlert) {
          const payload = {
            id: newAlert.id || 'TEMP-' + Date.now(),
            tripId: parseInt(tripId),
            status: newAlert.trip?.status || 'unknown',
            callerRole,
            callerId,
            lat: lat || newAlert.lat,
            lng: lng || newAlert.lng,
            passenger: {
              name: newAlert.trip?.customer?.fullName || newAlert.trip?.customer?.user?.fullName || 'N/A',
              phone: newAlert.trip?.customer?.user?.phone || 'N/A'
            },
            driver: {
              name: newAlert.trip?.driver?.fullName || newAlert.trip?.driver?.user?.fullName || 'N/A',
              phone: newAlert.trip?.driver?.user?.phone || 'N/A',
              vehiclePlate: newAlert.trip?.vehicle?.plateNumber || 'N/A'
            },
            timestamp: newAlert.createdAt || new Date()
          };

          // 3. BROADCAST TO ALL ADMINS
          io.emit('admin:sos_alert', payload);
          logger.warn({ tripId }, '[SOS ALERT] Broadcasted to admins!');
        }
        
      } catch (err) {
        logger.error(err, '[SOS ERROR] Global failure in SOS socket');
      }
    });

    // ==========================================
    // --- XỬ LÝ CHAT ---
    // ==========================================

    socket.on('chat:join', (data) => {
      const { tripId } = data;
      socket.join(`chat_${tripId}`);
      logger.debug({ socketId: socket.id, tripId }, 'Socket joined chat room');
    });

    socket.on('chat:send_message', async (data) => {
      try {
        const { tripId, senderId, content, messageType = 'text', fileUrl, tempId } = data;
        
        // 1. Tìm conversation của trip
        const conversation = await prisma.conversation.findUnique({
          where: { tripId: parseInt(tripId) }
        });

        if (!conversation) {
          logger.error({ tripId }, '[CHAT ERROR] Conversation not found');
          return;
        }

        // 2. Lưu message vào DB
        const dbMessage = await prisma.message.create({
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

        // 3. Chuẩn bị message để gửi đi (bao gồm cả tempId để App khớp dữ liệu)
        const message = { ...dbMessage, tempId };

        // 4. Broadcast tới các bên trong trip
        // Gửi qua room trip_ để những người đang ở màn hình tracking nhận được badge
        io.to(`trip_${tripId}`).emit('chat:receive_message', message);
        
        // Gửi qua room chat_ (nếu có tách biệt)
        io.to(`chat_${tripId}`).emit('chat:new_message', message);

      } catch (error) {
        logger.error(error, '[CHAT ERROR] Send message error');
      }
    });

    socket.on('disconnect', async () => {
      logger.debug({ socketId: socket.id }, 'Socket disconnected');
      
      // Tìm driver ID gắn với socket này (nếu có)
      // Thông thường driverId được đính kèm vào socket object lúc register
      // Nếu không, ta có thể dùng Map để track socketId -> driverId
    });
  });

  // TỐI ƯU: Xử lý ngắt kết nối thực sự cho tài xế
  // Do Socket.io disconnect có thể do mạng chập chờn, ta dùng một grace period (30s)
  io.of("/").adapter.on("leave-room", async (room, id) => {
    if (room.startsWith("driver_")) {
      const driverId = parseInt(room.replace("driver_", ""));
      if (isNaN(driverId)) return;

      // Đợi 30 giây xem họ có join lại không
      setTimeout(async () => {
        const activeSockets = await io.in(room).fetchSockets();
        if (activeSockets.length === 0) {
          logger.info({ driverId }, '[SOCKET] Driver offline (No active sockets)');
          await prisma.driver.update({
            where: { id: driverId },
            data: { isOnline: false }
          }).catch(e => logger.error(e, "Error setting driver offline"));
        }
      }, 30000); 
    }
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
