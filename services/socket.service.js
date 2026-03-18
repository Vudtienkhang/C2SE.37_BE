import { Server } from 'socket.io';
import prisma from '../prisma/prisma.js';

let io;

export const initSocket = (server) => {
  io = new Server(server, {
    cors: {
      origin: '*', // Trong thực tế nên giới hạn origin
      methods: ['GET', 'POST'],
    },
  });

  console.log('Socket.io initialized');

  io.on('connection', (socket) => {
    console.log(`New connection: ${socket.id}`);

    // 1. Đăng ký người dùng/tài xế để nhận thông báo riêng
    socket.on('user:register', (userId) => {
      socket.join(`user_${userId}`);
      console.log(`User ${userId} joined their private room`);
    });

    socket.on('driver:register', async (driverId) => {

      try {
        const id = parseInt(driverId);
        if (isNaN(id)) {
          console.error('Invalid driverId received in driver:register:', driverId);
          return;
        }

        socket.join(`driver_${id}`);
        socket.join('drivers');
        console.log(`[SOCKET] Driver ${id} joined rooms: drivers, driver_${id}`);
        console.log(`[SOCKET] Current rooms for ${socket.id}:`, Array.from(socket.rooms));

        
        await prisma.driver.update({
          where: { id: id },
          data: { isOnline: true },
        });
      } catch (err) {
        console.error('Error in driver:register:', err);
      }
    });


    // Tài xế cập nhật vị trí
    socket.on('driver:update_location', async (data) => {
      try {
        const { driverId, lat, lng } = data;
        const id = parseInt(driverId);
        if (isNaN(id)) return;

        console.log(`[SOCKET] Received location from Driver ${id}: ${lat}, ${lng}`);

        await prisma.driver.update({
          where: { id: id },
          data: {
            currentLat: lat,
            currentLng: lng,
            lastLocationAt: new Date(),
          },
        });

        console.log(`[DATABASE] Updated Driver ${id} location in DB`);
        io.emit('driver:location_changed', { driverId: id, lat, lng });

      } catch (err) {
        console.error('Error in driver:update_location:', err);
      }
    });


    // Tài xế offline
    socket.on('driver:go_offline', async (driverId) => {
      socket.leave('drivers');
      await prisma.driver.update({
        where: { id: parseInt(driverId) },
        data: { isOnline: false },
      });
      console.log(`Driver ${driverId} went offline`);
    });

    // ==========================================
    // --- XỬ LÝ CHUYẾN ĐI (TRIP FLOW) ---
    // ==========================================

    // 1. Khách hàng gửi yêu cầu chuyến đi cho 1 tài xế
    socket.on('trip:request', async (data) => {
      try {
        const { 
          passengerId, // Đây là userId của khách
          driverId, 
          pickupAddress, pickupLat, pickupLng,
          dropoffAddress, dropoffLat, dropoffLng,
          distanceKm, durationEstimateMin, priceEstimate 
        } = data;

        console.log(`[TRIP] New request: User ${passengerId} -> Driver ${driverId}`);

        // Tìm customerId từ userId, nếu chưa có thì tự động tạo (để tiện test)
        let customer = await prisma.customer.findUnique({
          where: { userId: parseInt(passengerId) }
        });

        if (!customer) {
          console.log(`[TRIP] Customer not found for userId: ${passengerId}. Creating temporary profile...`);
          customer = await prisma.customer.create({
            data: { userId: parseInt(passengerId) }
          });
        }

        // Tạo chuyến đi trong DB với trạng thái 'requested'

        const newTrip = await prisma.trip.create({
          data: {
            customerId: customer.id,
            driverId: parseInt(driverId),
            pickupAddress,
            pickupLat: parseFloat(pickupLat),
            pickupLng: parseFloat(pickupLng),
            dropoffAddress,
            dropoffLat: parseFloat(dropoffLat),
            dropoffLng: parseFloat(dropoffLng),
            distanceKm: parseFloat(distanceKm),
            durationEstimateMin: parseInt(durationEstimateMin),
            priceEstimate: parseFloat(priceEstimate),
            status: 'requested'
          },
          include: {
            customer: {
              include: {
                user: {
                  select: { fullName: true, phone: true, avatarUrl: true }
                }
              }
            }
          }
        });

        console.log(`[TRIP] Created Trip ID: ${newTrip.id}`);

        // Gửi thông báo đến tài xế (phòng driver_ID)
        io.to(`driver_${driverId}`).emit('trip:new_request', {
          tripId: newTrip.id,
          pickupAddress: newTrip.pickupAddress,
          dropoffAddress: newTrip.dropoffAddress,
          distance: newTrip.distanceKm,
          duration: newTrip.durationEstimateMin,
          price: newTrip.priceEstimate,
          passengerName: newTrip.customer.user.fullName,
          passengerAvatar: newTrip.customer.user.avatarUrl
        });

        // Phản hồi cho khách hàng là đã gửi yêu cầu thành công
        socket.emit('trip:request_sent', { tripId: newTrip.id });

      } catch (error) {
        console.error('[TRIP ERROR] Detailed flow error:', error);
        socket.emit('trip:error', { message: 'Lỗi hệ thống khi tạo chuyến đi' });
      }
    });

    // 2. Tài xế chấp nhận chuyến đi
    socket.on('trip:accept', async (data) => {
      try {
        const { tripId } = data;
        
        const updatedTrip = await prisma.trip.update({
          where: { id: parseInt(tripId) },
          data: { 
            status: 'accepted',
            paymentStatus: 'pending' 
          },
          include: {
            customer: true,
            driver: {
              include: { user: true }
            }
          }
        });

        // Đánh dấu tài xế đang bận
        await prisma.driver.update({
          where: { id: updatedTrip.driverId },
          data: { isBusy: true }
        });

        console.log(`[TRIP] Trip ${tripId} accepted by Driver ${updatedTrip.driverId}`);

        // Thông báo cho khách hàng
        io.to(`user_${updatedTrip.customer.userId}`).emit('trip:accepted', {
          tripId: updatedTrip.id,
          driverName: updatedTrip.driver.user.fullName,
          driverPhone: updatedTrip.driver.user.phone,
          vehiclePlate: "43A-123.45" // Mocking for now
        });

      } catch (error) {
        console.error('[TRIP ERROR] Accept error:', error);
        socket.emit('trip:error', { message: 'Không thể chấp nhận chuyến đi' });
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
