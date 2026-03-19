
      import { Server } from 'socket.io';
import prisma from '../prisma/prisma.js';

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

        // 3. TẠO CHUYẾN ĐI TRONG DATABASE
        const newTrip = await prisma.trip.create({
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
            status: 'accepted',
          },
          include: {
            driver: { include: { user: true } }
          }
        });

        socket.join(`trip_${newTrip.id}`);

        // 5. Thông báo cho các bên
        io.to(pending.customerSocketId).emit('trip:accepted', {
          tripId: newTrip.id,
          driverName: newTrip.driver.user.fullName,
          driverPhone: newTrip.driver.user.phone,
          vehiclePlate: "43A-123.45" 
        });

        socket.emit('trip:accept_success', { tripId: newTrip.id });

        // 6. Xóa khỏi pending
        pendingTrips.delete(requestId);

      } catch (error) {
        console.error('[TRIP ERROR] Accept error:', error);
        socket.emit('trip:error', { message: 'Lỗi khi chấp nhận chuyến đi' });
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
        const updatedTrip = await prisma.trip.update({
          where: { id: parseInt(tripId) },
          data: { status: status },
          include: { customer: { include: { user: true } } }
        });

        // Nếu hoàn thành hoặc hủy, giải phóng tài xế
        if (status === 'completed' || status === 'cancelled') {
          await prisma.driver.update({
            where: { id: updatedTrip.driverId },
            data: { isBusy: false }
          });
        }

        // Phát cho mọi người trong phòng chuyến đi (bao gồm passenger)
        io.to(`trip_${tripId}`).emit('trip:status_updated', {
          tripId: tripId,
          status: status
        });

        // Đồng thời phát cho riêng passenger qua user room (dự phòng)
        io.to(`user_${updatedTrip.customer.userId}`).emit('trip:status_updated', {
          tripId: tripId,
          status: status
        });

      } catch (error) {
        console.error('[TRIP ERROR] Update status error:', error);
      }
    });

    // Driver: Phát vị trí cho passenger trong chuyến đi
    socket.on('trip:location_update', (data) => {
      const { tripId, lat, lng } = data;
      // Chỉ phát cho những người đang theo dõi chuyến đi này
      socket.to(`trip_${tripId}`).emit('driver:location_changed', { lat, lng });
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
