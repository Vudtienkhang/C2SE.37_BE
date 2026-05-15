import { Server } from 'socket.io';
import prisma from '../prisma/prisma.js';
import redis from '../lib/redis.js';
import { getConfig } from './config.service.js';
import * as pricingService from './pricing.service.js';
import { tripTasksQueue } from '../lib/queue.js';
import logger from '../lib/logger.js';

export let io;
const pendingTrips = new Map(); 

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

    socket.on('driver:register', async (data) => {
      try {
        // Hỗ trợ cả 2 định dạng: driverId (cũ) hoặc { driverId, lat, lng } (mới)
        const driverId = typeof data === 'object' ? data.driverId : data;
        const lat = typeof data === 'object' ? data.lat : null;
        const lng = typeof data === 'object' ? data.lng : null;

        const id = parseInt(driverId);
        if (isNaN(id)) return;

        // 1. KIỂM TRA TRẠNG THÁI TÀI XẾ
        const driver = await prisma.driver.findFirst({
          where: { 
            OR: [
              { id: id },
              { userId: id }
            ]
          }
        });

        if (!driver || driver.status !== 'approved') {
          logger.warn({ driverId: id, status: driver?.status }, '[SOCKET] Driver registration rejected (Not approved)');
          socket.emit('driver:error', { message: 'Tài khoản của bạn chưa được duyệt hoặc bị khóa.' });
          return;
        }

        // 1.1 KIỂM TRA CHỨNG CHỈ HỌC VIỆN (Linh hoạt theo yêu cầu)
        const mandatoryQuizCount = await prisma.knowledgeQuiz.count({
          where: { isActive: true, isMandatory: true }
        });

        if (mandatoryQuizCount > 0 && !driver.hasPassedKnowledgeTest) {
          logger.warn({ driverId: id }, '[SOCKET] Driver registration rejected (Mandatory test not passed)');
          socket.emit('driver:error', { 
            code: 'NOT_CERTIFIED',
            message: 'Bạn cần hoàn thành các bài kiểm tra kiến thức bắt buộc tại Học viện để có thể bật ứng dụng nhận chuyến.' 
          });
          return;
        }

        const actualDriverId = driver.id;
        const userId = driver.userId;
        socket.driverId = actualDriverId;
        socket.userId = userId;
        
        socket.join(`driver_${actualDriverId}`);
        socket.join(`user_${userId}`); // Join thêm room user để dự phòng
        socket.join('drivers');
        
        logger.info({ 
          driverId: actualDriverId, 
          userId, 
          socketId: socket.id 
        }, '[SOCKET] Driver registered successfully and joined rooms');
        
        await prisma.driver.update({
          where: { id: actualDriverId },
          data: { isOnline: true },
        }).catch(err => logger.error(err, 'Error updating driver status'));

        // 2. GHI NHẬN PHIÊN ONLINE MỚI
        await prisma.onlineSession.create({
          data: { driverId: actualDriverId, startTime: new Date() }
        }).catch(err => logger.warn('[SOCKET] Failed to create online session:', err.message));

        // 3. KHÔI PHỤC VỊ TRÍ TỨC THÌ
        if (lat && lng) {
          // 3.1 Ưu tiên tọa độ mới nhất App gửi lên
          await redis.geoadd('drivers:locations', lng, lat, actualDriverId);
          await redis.set(`driver:${actualDriverId}:last_location`, JSON.stringify({ lat, lng, time: new Date() }));
          logger.info({ driverId: actualDriverId }, '[SOCKET] Driver location updated on register (Direct)');
        } else {
          // 3.2 Hoặc khôi phục từ Cache nếu có
          const lastLocStr = await redis.get(`driver:${actualDriverId}:last_location`);
          if (lastLocStr) {
            try {
              const lastLoc = JSON.parse(lastLocStr);
              await redis.geoadd('drivers:locations', lastLoc.lng, lastLoc.lat, actualDriverId);
              logger.info({ driverId: actualDriverId }, '[SOCKET] Driver location restored from cache on register');
            } catch (e) {}
          }
        }

        // 4. THÔNG BÁO CHO ADMIN (Real-time Management)
        io.emit('admin:driver_updated', { 
          driverId: actualDriverId, 
          status: 'online',
          timestamp: new Date() 
        });

        logger.info({ driverId: actualDriverId }, '[SOCKET] Driver registered and online notified to admin');
      } catch (err) {
        logger.error(err, 'Error in driver:register');
      }
    });

    socket.on('user:update_location', async (data) => {
      try {
        const { userId, lat, lng } = data;
        if (!userId) return;
        
        await redis.set(`user:${userId}:last_location`, JSON.stringify({ 
          lat, 
          lng, 
          time: new Date() 
        }), 'EX', 3600); // Lưu trong 1 tiếng
      } catch (err) {
        logger.error(err, 'Error in user:update_location');
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
        
        // Cập nhật vị trí cho admin (nếu admin đang xem bản đồ)
        io.emit('admin:driver_location_updated', { driverId: actualDriverId, lat, lng });
      } catch (err) {
        logger.error(err, 'Error in driver:update_location');
      }
    });

    // ==========================================
    // --- XỬ LÝ CHUYẾN ĐI (SEQUENTIAL FLOW) ---
    // ==========================================

    const DRIVER_DEBT_LIMIT = -100000;

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

      // --- KIỂM TRA KHÓA "ĐANG CÂN NHẮC" (CHỐNG CHỒNG CHÉO) ---
      const isLocked = await redis.get(`driver:${driverId}:lock`);
      if (isLocked) {
        logger.info({ driverId, requestId }, '[TRIP] Driver is considering another trip. Skipping...');
        return notifyNextDriver(requestId);
      }

      // Khóa tài xế này trong 32 giây (30s chờ + 2s trừ hao)
      await redis.set(`driver:${driverId}:lock`, requestId, 'EX', 32);

      // --- KIỂM TRA NỢ XẤU TÀI XẾ (BẢO VỆ ADMIN) ---
      try {
        // Lấy đúng userId của tài xế để kiểm tra ví (Bug fix: driverId ở đây là Driver.id)
        const driverObj = await prisma.driver.findUnique({
          where: { id: driverId },
          select: { userId: true }
        });

        if (driverObj) {
          const driverWallet = await prisma.wallet.findUnique({
            where: { userId: driverObj.userId }
          });

          if (driverWallet && driverWallet.balance <= DRIVER_DEBT_LIMIT) {
            logger.warn({ driverId, balance: driverWallet.balance }, '[TRIP] Driver has excessive debt. Skipping...');
            // Tự động chuyển sang tài xế tiếp theo ngay lập tức
            return notifyNextDriver(requestId);
          }
        }
      } catch (err) {
        logger.error(err, '[TRIP] Error checking driver wallet in notifyNextDriver');
      }

      logger.info({ driverId, requestId }, '[TRIP] Notifying driver for request');

      // 1.5 GHI NHẬN CƠ HỘI NHẬN CHUYẾN (TRIP OFFER)
      await prisma.tripOffer.create({
        data: {
          requestId,
          driverId,
          status: 'PENDING',
          offeredAt: new Date()
        }
      }).catch(err => logger.error('[TRIP OFFER ERROR] Failed to create:', err.message));

      // 2. Gửi yêu cầu tới tài xế (Kiểm tra cả room driver và room user)
      const roomName = `driver_${driverId}`;
      const socketsInRoom = io.sockets.adapter.rooms.get(roomName);
      const clientCount = socketsInRoom ? socketsInRoom.size : 0;
      
      logger.info({ 
        driverId, 
        requestId, 
        clientCount,
        room: roomName
      }, '[TRIP] Emitting trip:new_request');

      // Gửi vào room driver
      io.to(roomName).emit('trip:new_request', {
        requestId,
        ...pending.data,
        price: pending.data.price, // Giữ giá gốc để tài xế thấy đúng thu nhập (80% của giá gốc)
        discountAmount: pending.data.discountAmount || 0
      });

      // 3. Đặt timeout 30 giây
      pending.timeout = setTimeout(async () => {
        logger.info({ driverId, requestId }, '[TRIP] Driver timed out for request');
        
        // Cập nhật trạng thái MISSED nếu tài xế không phản hồi
        await prisma.tripOffer.updateMany({
          where: { requestId, driverId, status: 'PENDING' },
          data: { status: 'MISSED', respondedAt: new Date() }
        }).catch(() => {});

        notifyNextDriver(requestId);
      }, 30000); 
    };

    const calculateHaversine = (lat1, lon1, lat2, lon2) => {
      const R = 6371; // Bán kính trái đất (km)
      const dLat = (lat2 - lat1) * (Math.PI / 180);
      const dLon = (lon2 - lon1) * (Math.PI / 180);
      const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
                Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) * 
                Math.sin(dLon / 2) * Math.sin(dLon / 2);
      const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      return R * c;
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
          serviceType = 'FOR_HIRE', // Giá trị mặc định
          ...tripData 
        } = data;

        // 1. NGĂN CHẶN TRÙNG LẶP VÀ CHUẨN BỊ DANH SÁCH
        let finalizedDriverIds = [...new Set(rawDriverIds || [])];

        // 1.1 TỰ ĐỘNG QUÉT MỞ RỘNG TRÊN SERVER NẾU DANH SÁCH TRỐNG
        if (finalizedDriverIds.length === 0 && pickupLat && pickupLng) {
          logger.info({ passengerId }, '[TRIP] Client sent empty driver list. Performing server-side auto-scan...');
          const searchRadii = [5, 10, 15];
          for (const r of searchRadii) {
            // Lấy cả member (ID) và distance từ Redis
            const nearby = await redis.geosearch(
              'drivers:locations',
              'FROMLONLAT', pickupLng, pickupLat,
              'BYRADIUS', r, 'km',
              'ASC',
              'WITHDIST'
            );
            
            if (nearby && nearby.length > 0) {
              // nearby lúc này có dạng: [[driverId, distance], [driverId, distance], ...]
              const driverDistancesMap = new Map();
              finalizedDriverIds = nearby.map(item => {
                const dId = parseInt(item[0]);
                driverDistancesMap.set(dId, parseFloat(item[1]));
                return dId;
              });
              socket.driverDistancesMap = driverDistancesMap; // Lưu tạm để dùng cho bước sort sau
              logger.info({ radius: r, count: finalizedDriverIds.length }, '[TRIP] Server-side scan found drivers');
              break;
            }
          }
        }

        if (finalizedDriverIds.length === 0) {
          socket.emit('trip:no_driver_found', { message: 'Không tìm thấy tài xế nào trong phạm vi 15km.' });
          return;
        }

        // 2. KIỂM TRA REQUEST ĐANG CHỜ (PHE TRUNG GIAN)
        for (const [id, pending] of pendingTrips.entries()) {
          if (pending.data.passengerId === parseInt(passengerId)) {
            socket.emit('trip:error', { message: 'Bạn đang có một yêu cầu tìm tài xế đang xử lý' });
            return;
          }
        }

        // 2.1 KIỂM TRA CHUYẾN ĐI ĐANG THỰC HIỆN (TRONG DATABASE)
        const activeTrip = await prisma.trip.findFirst({
          where: {
            customerId: parseInt(passengerId),
            status: {
              in: ['requested', 'accepted', 'arrived', 'started']
            }
          }
        });

        if (activeTrip) {
          socket.emit('trip:error', { 
            message: 'Bạn đang có một chuyến đi chưa hoàn thành. Vui lòng kết thúc chuyến hiện tại trước khi đặt chuyến mới.' 
          });
          return;
        }

        // 3. XÁC THỰC KHOẢNG CÁCH VÀ SẮP XẾP ƯU TIÊN THEO HẠNG
        const rankPriorities = await getConfig('DRIVER_RANK_PRIORITY', {
          SILVER: 1.0,
          GOLD: 1.1,
          PLATINUM: 1.25,
          DIAMOND: 1.5
        });

        // 3.2. Lấy thông tin tài xế để tính khoảng cách hiệu dụng (Tối ưu select)
        const driversData = await prisma.driver.findMany({
          where: { 
            id: { in: finalizedDriverIds },
            isOnline: true,
            isBusy: false,
            status: 'approved',
            // Lọc theo loại hình dịch vụ tài xế đăng ký
            ...(serviceType === 'FOR_HIRE' ? {
              serviceType: { in: ['FOR_HIRE', 'BOTH'] }
            } : {
              // Đối với Taxi (RIDE_HAILING) - Yêu cầu có xe phù hợp
              serviceType: { in: ['RIDE_HAILING', 'BOTH'] },
              vehicles: {
                some: { 
                  type: vehicleType ? vehicleType.toLowerCase() : undefined,
                  status: 'approved' 
                }
              }
            })
          },
          select: { 
            id: true,
            user: { 
              select: { 
                fullName: true, 
                phone: true, 
                wallet: { select: { balance: true } } 
              } 
            },
            DriverRank: {
              select: { code: true }
            }
          }
        });

        // Lọc bỏ tài xế nợ xấu trước khi tính toán priority
        const filteredDriversData = driversData.filter(d => (d.user?.wallet?.balance || 0) > DRIVER_DEBT_LIMIT);

        // 3.3. Tính toán và sắp xếp lại driverIds dựa trên công thức: EffectiveDistance = ActualDistance / Multiplier
        const driverDistancesMap = socket.driverDistancesMap || new Map();
        
        // Nếu App tự gửi danh sách driverIds lên, driverDistancesMap sẽ trống
        // Ta cần lấy tọa độ của toàn bộ tài xế bằng 1 lệnh GEOPOS duy nhất (TỐI ƯU NHẤT)
        if (driverDistancesMap.size === 0 && finalizedDriverIds.length > 0) {
          const positions = await redis.geopos('drivers:locations', ...finalizedDriverIds);
          // positions có dạng [[lng, lat], [lng, lat], ...] hoặc [null, ...]
          finalizedDriverIds.forEach((id, index) => {
            const pos = positions[index];
            if (pos) {
              const dist = calculateHaversine(
                parseFloat(pickupLat), 
                parseFloat(pickupLng), 
                parseFloat(pos[1]), 
                parseFloat(pos[0])
              );
              driverDistancesMap.set(id, dist);
            } else {
              driverDistancesMap.set(id, 999); // Không thấy vị trí
            }
          });
        }

        const sortedDrivers = finalizedDriverIds
          .map((dId) => {
            const driver = filteredDriversData.find(d => d.id === dId);
            if (!driver) return null;

            const actualDist = driverDistancesMap.get(dId) || 999;
            const multiplier = rankPriorities[driver.DriverRank?.code] || 1.0;

            return {
              id: dId,
              effectiveDistance: actualDist / multiplier
            };
          })
          .filter(d => d !== null)
          .sort((a, b) => a.effectiveDistance - b.effectiveDistance)
          .map(d => d.id);

        finalizedDriverIds = sortedDrivers;

        logger.info({ 
          originalCount: rawDriverIds?.length || 0, 
          finalCount: finalizedDriverIds.length 
        }, '[PRIORITY] Drivers re-sorted for Request');

        if (finalizedDriverIds.length === 0) {
          const vehicleLabel = vehicleType === 'bike' ? 'xe máy' : vehicleType === 'car_4' ? 'ô tô 4 chỗ' : vehicleType === 'car_7' ? 'ô tô 7 chỗ' : 'phù hợp';
          socket.emit('trip:error', { 
            message: serviceType === 'RIDE_HAILING' 
              ? `Rất tiếc, hiện không có tài xế ${vehicleLabel} nào ở gần bạn. Vui lòng thử lại sau ít phút.`
              : 'Rất tiếc, không tìm thấy tài xế nào khả dụng tại thời điểm này.'
          });
          return;
        }

        // 4. TÍNH TOÁN GIÁ CHÍNH XÁC VÀ BREAKDOWN (MỚI)
        const priceBreakdown = await pricingService.calculateTripPrice({
          distanceKm: parseFloat(distance),
          durationMin: parseFloat(duration),
          vehicleType,
          serviceType, // Truyền serviceType vào
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
            serviceType, // Lưu lại serviceType
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


    socket.on('trip:decline', async (data) => {
      const { requestId } = data;
      const pending = pendingTrips.get(requestId);
      if (pending) {
        logger.info({ requestId }, '[TRIP] Driver declined request. Moving to next...');
        
        // Cập nhật trạng thái REJECTED cho tài xế vừa từ chối
        if (socket.driverId) {
          await prisma.tripOffer.updateMany({
            where: { requestId, driverId: socket.driverId, status: 'PENDING' },
            data: { status: 'REJECTED', respondedAt: new Date() }
          }).catch(() => {});
        }

        clearTimeout(pending.timeout);
        // Giải phóng khóa khi tài xế chủ động từ chối
        if (socket.driverId) {
          await redis.del(`driver:${socket.driverId}:lock`);
        }
        notifyNextDriver(requestId);
      }
    });

    socket.on('trip:accept', async (data) => {
      try {
        const { requestId, driverId } = data;
        const parsedDriverId = parseInt(driverId);
        
        // 1. Giải phóng khóa ngay lập tức
        await redis.del(`driver:${driverId}:lock`);
        
        const pending = pendingTrips.get(requestId);
        if (!pending) {
          socket.emit('trip:error', { message: 'Yêu cầu này không còn tồn tại hoặc đã được tài xế khác nhận.' });
          return;
        }

        // --- KHÓA YÊU CẦU NGAY LẬP TỨC ---
        pendingTrips.delete(requestId);
        clearTimeout(pending.timeout);

        const discountAmount = pending.data.discountAmount || 0;
        const finalPrice = Math.max(0, (parseFloat(pending.data.price) - discountAmount));

        // 2. TRANSACTION TỔNG HỢP (Tối ưu số lần gọi DB)
        const trip = await prisma.$transaction(async (tx) => {
          // 2.0 Kiểm tra ví nếu dùng WALLET
          if (pending.data.paymentMethod === 'WALLET') {
            const wallet = await tx.wallet.findUnique({
              where: { userId: pending.data.passengerId }
            });
            if (!wallet || wallet.balance < finalPrice) {
              throw new Error('INSUFFICIENT_BALANCE');
            }
          }

          // 2.1 Cập nhật trạng thái Offer
          await tx.tripOffer.updateMany({
            where: { requestId, driverId: parsedDriverId },
            data: { status: 'ACCEPTED', respondedAt: new Date() }
          }).catch(() => {});

          // 2.2 Upsert Customer (Tìm hoặc tạo trong 1 câu lệnh)
          const customer = await tx.customer.upsert({
            where: { userId: pending.data.passengerId },
            update: {},
            create: { userId: pending.data.passengerId }
          });
          // 2.3 Tạo mới hoặc Cập nhật Trip (Xử lý Re-dispatch)
          let newTrip;
          if (pending.data.isRedispatch && pending.data.originalTripId) {
            newTrip = await tx.trip.update({
              where: { id: pending.data.originalTripId },
              data: {
                driverId: parsedDriverId,
                status: 'accepted',
                vehicleId: pending.data.vehicleId ? parseInt(pending.data.vehicleId) : null,
              },
              include: { 
                driver: { 
                  include: { 
                    user: { select: { fullName: true, phone: true, avatarUrl: true } },
                    vehicles: { where: { isDefault: true } }
                  } 
                } 
              }
            });
          } else {
            newTrip = await tx.trip.create({
              data: {
                customerId: customer.id,
                driverId: parsedDriverId,
                pickupAddress: pending.data.pickupAddress,
                pickupLat: parseFloat(pending.data.pickupLat),
                pickupLng: parseFloat(pending.data.pickupLng),
                dropoffAddress: pending.data.dropoffAddress,
                dropoffLat: parseFloat(pending.data.dropoffLat),
                dropoffLng: parseFloat(pending.data.dropoffLng),
                distanceKm: parseFloat(pending.data.distance),
                durationEstimateMin: parseInt(pending.data.duration),
                priceEstimate: finalPrice,
                routePolyline: pending.data.routePolyline,
                vehicleId: pending.data.vehicleId ? parseInt(pending.data.vehicleId) : null,
                serviceType: pending.data.serviceType || 'FOR_HIRE',
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
                driver: { 
                  include: { 
                    user: { select: { fullName: true, phone: true, avatarUrl: true } },
                    vehicles: { where: { isDefault: true } }
                  } 
                } 
              }
            });
          }

          // 2.4 Cập nhật trạng thái tài xế bận
          await tx.driver.update({
            where: { id: parsedDriverId },
            data: { isBusy: true }
          });

          return newTrip;
        }, { maxWait: 5000, timeout: 15000 });

        // 3. PHẢN HỒI NGAY LẬP TỨC CHO TÀI XẾ (Giảm cảm giác chờ đợi)
        socket.emit('trip:accept_success', { 
          tripId: trip.id,
          trip: trip 
        });
        socket.join(`trip_${trip.id}`);

        // 4. CÁC TÁC VỤ PHỤ (Không await để không chặn luồng chính)
        (async () => {
          try {
            // Đẩy vào queue xử lý tài chính
            tripTasksQueue.add('PROCESS_TRIP_ACCEPTANCE', {
              tripId: trip.id,
              passengerId: pending.data.passengerId,
              paymentMethod: pending.data.paymentMethod || 'CASH',
              finalPrice: finalPrice,
              voucherId: pending.data.voucherId,
              discountAmount: discountAmount
            });

            // Thông báo cho khách hàng
            io.to(pending.customerSocketId).emit('trip:accepted', {
              tripId: trip.id,
              driverName: trip.driver.user.fullName,
              driverPhone: trip.driver.user.phone,
              vehiclePlate: trip.serviceType === 'RIDE_HAILING' 
                ? (trip.driver.vehicles[0]?.plateNumber || "Đang cập nhật") 
                : "Xe khách hàng",
              serviceType: trip.serviceType
            });

            if (pending.data.paymentMethod === 'WALLET') {
              io.to(`user_${pending.data.passengerId}`).emit('wallet:updated', { reason: 'escrow_hold' });
            }

            io.emit('admin:trip_updated', { tripId: trip.id, type: 'new_trip' });
          } catch (e) {
            logger.error(e, '[TRIP] Error in post-acceptance tasks');
          }
        })();

      } catch (error) {
        logger.error(error, '[TRIP ERROR] Accept error');
        if (error.message === 'INSUFFICIENT_BALANCE') {
          socket.emit('trip:error', { message: 'Số dư ví khách hàng không đủ để thực hiện chuyến đi này.' });
          // Thông báo cho khách
          const pending = pendingTrips.get(requestId);
          if (pending) {
            io.to(pending.customerSocketId).emit('trip:error', { message: 'Số dư ví không đủ. Vui lòng nạp thêm tiền hoặc đổi phương thức thanh toán.' });
          }
        } else {
          socket.emit('trip:error', { message: 'Lỗi khi chấp nhận chuyến đi' });
        }
      }
    });

    // Tham gia phòng để theo dõi chuyến đi cụ thể
    socket.on('trip:join', (tripId) => {
      socket.join(`trip_${tripId}`);
      socket.join(`chat_${tripId}`); // Tự động vào luôn phòng chat để nhận tin nhắn realtime ổn định hơn
      logger.debug({ socketId: socket.id, tripId }, 'Socket joined trip and chat rooms');
    });

    socket.on('admin:join_trip', (data) => {
      const { tripId } = data;
      socket.join(`trip_${tripId}`);
      socket.join(`chat_${tripId}`);
      logger.info({ socketId: socket.id, tripId }, '[ADMIN] Joined trip room for monitoring');
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
          'started': ['completed'] // CHỈ cho phép hoàn thành khi đã bắt đầu di chuyển
        };

        if (validTransitions[currentTrip.status] && !validTransitions[currentTrip.status].includes(status)) {
          logger.warn({ tripId, from: currentTrip.status, to: status }, '[SOCKET WARN] Invalid status transition');
          // Nếu trạng thái mới trùng với trạng thái hiện tại, có thể do App bị lag chưa nhận được emit cũ
          // Ta phát lại emit để App đồng bộ lại giao diện
          if (currentTrip.status === status) {
            io.to(`trip_${tripId}`).emit('trip:status_updated', { tripId, status });
          } else {
            socket.emit('trip:error', { message: `Không thể chuyển từ ${currentTrip.status} sang ${status}` });
          }
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

          // 4. PERSISTENT NOTIFICATION FOR ALL ADMINS
          const notificationService = (await import('./notification.service.js')).default;
          await notificationService.notifyAdmins(
            'CẢNH BÁO SOS KHẨN CẤP',
            `Yêu cầu cứu trợ từ ${callerRole === 'driver' ? 'tài xế' : 'khách hàng'} tại chuyến đi #${tripId}`,
            'EMERGENCY',
            { tripId: parseInt(tripId), alertId: payload.id }
          ).catch(e => logger.error('[SOS] Failed to notify admins:', e.message));

          // 5. ALERT NEARBY DRIVERS (RADIUS 2KM)
          if (lat && lng) {
            try {
              const nearby = await redis.geosearch(
                'drivers:locations',
                'FROMLONLAT', parseFloat(lng), parseFloat(lat),
                'BYRADIUS', 2, 'km',
                'ASC'
              );
              
              if (nearby && nearby.length > 0) {
                nearby.forEach(dId => {
                  // Không gửi cho chính người gọi nếu người gọi là tài xế
                  if (callerRole === 'driver' && parseInt(dId) === parseInt(callerId)) return;
                  
                  io.to(`driver_${dId}`).emit('trip:sos_nearby', {
                    tripId: parseInt(tripId),
                    lat: parseFloat(lat),
                    lng: parseFloat(lng),
                    message: 'CẢNH BÁO: Có yêu cầu cứu trợ khẩn cấp gần vị trí của bạn!'
                  });
                });
                logger.info({ count: nearby.length }, '[SOS] Alerted nearby drivers');
              }
            } catch (geoErr) {
              logger.error(geoErr, '[SOS GEO ERROR] Failed to search nearby drivers');
            }
          }
        }
        
      } catch (err) {
        logger.error(err, '[SOS ERROR] Global failure in SOS socket');
      }
    });

    // ==========================================
    // --- ĐIỀU PHỐI KHẨN CẤP (ADMIN INTERVENTION) ---
    // ==========================================

    // Admin Chat: Cho phép Admin gửi tin nhắn vào cuộc hội thoại của chuyến đi
    socket.on('admin:send_chat', async (data) => {
      try {
        const { tripId, senderId, content } = data;
        logger.info({ tripId }, '[ADMIN CHAT] Admin sending intervention message');

        // Tự động tạo hội thoại nếu chưa tồn tại
        const conversation = await prisma.conversation.upsert({
          where: { tripId: parseInt(tripId) },
          update: {},
          create: { tripId: parseInt(tripId) }
        });

        const dbMessage = await prisma.message.create({
          data: {
            conversationId: conversation.id,
            senderId: parseInt(senderId), // ID của Admin
            content: `[HỆ THỐNG]: ${content}`,
            messageType: 'text',
          },
          include: { sender: { select: { fullName: true } } }
        });

        // Broadcast tới cả tài xế và khách hàng, kèm theo tripId để frontend dễ lọc
        const emitData = { ...dbMessage, tripId: parseInt(tripId) };
        io.to(`trip_${tripId}`).to(`chat_${tripId}`).emit('chat:receive_message', emitData);
        io.to(`trip_${tripId}`).to(`chat_${tripId}`).emit('chat:new_message', emitData);
        
        logger.info({ tripId }, '[ADMIN CHAT] Message delivered');
      } catch (err) {
        logger.error(err, '[ADMIN CHAT ERROR]');
      }
    });

    // Admin Join Room: Cho phép Admin tham gia vào phòng của chuyến đi để nhận chat real-time
    socket.on('admin:join_trip', (data) => {
      try {
        const { tripId } = data;
        socket.join(`trip_${tripId}`);
        socket.join(`chat_${tripId}`);
        logger.info({ tripId, socketId: socket.id }, '[ADMIN] Joined trip/chat rooms');
      } catch (err) {
        logger.error(err, '[ADMIN JOIN ROOM ERROR]');
      }
    });

    // Admin Leave Room: Thoát khỏi phòng khi không theo dõi nữa
    socket.on('admin:leave_trip', (data) => {
      try {
        const { tripId } = data;
        socket.leave(`trip_${tripId}`);
        socket.leave(`chat_${tripId}`);
        logger.info({ tripId, socketId: socket.id }, '[ADMIN] Left trip/chat rooms');
      } catch (err) {
        logger.error(err, '[ADMIN LEAVE ROOM ERROR]');
      }
    });

    // Admin Re-dispatch: Điều xe khác thay thế cho tài xế hiện tại
    socket.on('admin:re_dispatch', async (data) => {
      try {
        const { tripId, reason } = data;
        logger.warn({ tripId, reason }, '[ADMIN DISPATCH] Re-dispatching trip');

        // 1. Lấy thông tin chuyến đi
        const trip = await prisma.trip.findUnique({
          where: { id: parseInt(tripId) },
          include: { 
            customer: { include: { user: true } },
            driver: true 
          }
        });

        if (!trip || ['completed', 'cancelled'].includes(trip.status)) {
          return socket.emit('admin:error', { message: 'Không thể điều lại chuyến đi này' });
        }

        // 2. Giải phóng tài xế cũ
        if (trip.driverId) {
          await prisma.driver.update({
            where: { id: trip.driverId },
            data: { isBusy: false }
          });
          
          // Thông báo cho tài xế cũ
          io.to(`driver_${trip.driverId}`).emit('trip:cancelled_by_admin', { 
            tripId, 
            reason: 'Hệ thống đã điều xe khác thay thế bạn để hỗ trợ khách hàng.' 
          });
          logger.info({ driverId: trip.driverId }, '[ADMIN DISPATCH] Old driver released');
        }

        // 3. Cập nhật trạng thái chuyến đi về 'requested' để bắt đầu tìm lại
        await prisma.trip.update({
          where: { id: parseInt(tripId) },
          data: { 
            status: 'requested',
            driverId: null,
            driverVehicleId: null,
            cancelReason: `Admin Re-dispatch: ${reason}`
          }
        });

        // 4. Kích hoạt lại luồng tìm xe (Search flow)
        // Tìm tài xế xung quanh vị trí điểm đón cũ
        const nearby = await redis.geosearch(
          'drivers:locations',
          'FROMLONLAT', trip.pickupLng, trip.pickupLat,
          'BYRADIUS', 5, 'km',
          'ASC'
        );

        if (nearby && nearby.length > 0) {
          const requestId = `req_dispatch_${Date.now()}_${trip.customerId}`;
          
          // Lọc bỏ tài xế cũ để không nhận lại ngay lập tức
          const filteredDrivers = nearby
            .map(id => parseInt(id))
            .filter(id => id !== trip.driverId);

          pendingTrips.set(requestId, {
            data: {
              pickupAddress: trip.pickupAddress,
              pickupLat: trip.pickupLat,
              pickupLng: trip.pickupLng,
              dropoffAddress: trip.dropoffAddress,
              price: trip.priceEstimate,
              passengerName: trip.customer.user.fullName,
              passengerId: trip.customer.userId,
              serviceType: trip.serviceType,
              isRedispatch: true,
              originalTripId: trip.id
            },
            driverIds: filteredDrivers,
            currentIndex: 0,
            timeout: null,
            // Chúng ta không có socketId gốc của khách, nhưng có thể tìm qua room
            customerSocketId: `user_${trip.customer.userId}` 
          });

          notifyNextDriver(requestId);
          
          // Thông báo cho khách hàng
          io.to(`user_${trip.customer.userId}`).emit('trip:status_updated', { 
            tripId: trip.id, 
            status: 'requested',
            message: 'Hệ thống đang điều xe khác đến hỗ trợ bạn. Vui lòng đợi trong giây lát.'
          });

          socket.emit('admin:success', { message: 'Đã bắt đầu quy trình điều xe thay thế.' });
        } else {
          socket.emit('admin:error', { message: 'Không tìm thấy tài xế nào khả dụng xung quanh để thay thế.' });
        }

      } catch (err) {
        logger.error(err, '[ADMIN DISPATCH ERROR]');
        socket.emit('admin:error', { message: 'Lỗi hệ thống khi điều xe thay thế.' });
      }
    });

    // ==========================================
    // --- SAFEWAY NOW (Ghép cặp tại chỗ) ---
    // ==========================================

    // 1. Khách hàng yêu cầu mã PIN/QR
    socket.on('trip:request_now_code', async (data) => {
      try {
        const { 
          passengerId, passengerName, passengerAvatar,
          pickupAddress, pickupLat, pickupLng, 
          dropoffAddress, dropoffLat, dropoffLng, 
          price, distance, duration, serviceType, vehicleType 
        } = data;
        
        // Sinh mã PIN 6 số
        const pinCode = Math.floor(100000 + Math.random() * 900000).toString();
        
        const pairingData = {
          passengerId,
          passengerName,
          passengerAvatar,
          pickupAddress,
          pickupLat,
          pickupLng,
          dropoffAddress,
          dropoffLat,
          dropoffLng,
          price,
          distance,
          duration,
          serviceType, // FOR_HIRE hoặc RIDE_HAILING
          vehicleType, // bike, car_4, car_7...
          createdAt: Date.now()
        };

        const pairingKey = `now_pairing:${pinCode}`;
        const userKey = `now_user_pairing:${passengerId}`;

        // Lưu vào Redis (Hết hạn sau 5 phút)
        await redis.set(pairingKey, JSON.stringify(pairingData), 'EX', 300);
        await redis.set(userKey, pinCode, 'EX', 300);

        logger.info({ pinCode, passengerId }, '[SAFEWAY NOW] PIN Generated');
        socket.emit('trip:now_code_generated', { pinCode });

      } catch (error) {
        logger.error(error, '[SAFEWAY NOW] Error generating PIN');
        socket.emit('trip:error', { message: 'Lỗi khi tạo mã kết nối tại chỗ.' });
      }
    });

    // 2. Tài xế xác thực mã PIN/QR
    socket.on('trip:verify_now_code', async (data) => {
      try {
        const { pinCode, driverId, driverLat, driverLng } = data;
        const pairingKey = `now_pairing:${pinCode}`;

        // 1. Tối ưu: Lấy pairingData và driverData song song
        const [pairingDataStr, driver] = await Promise.all([
          redis.get(pairingKey),
          prisma.driver.findUnique({
            where: { id: parseInt(driverId) },
            include: { vehicles: { where: { isDefault: true } } }
          })
        ]);

        if (!pairingDataStr) {
          return socket.emit('trip:error', { message: 'Mã kết nối không hợp lệ hoặc đã hết hạn.' });
        }
        if (!driver) {
          return socket.emit('trip:error', { message: 'Không tìm thấy thông tin tài xế' });
        }

        const pairingData = JSON.parse(pairingDataStr);

        // Kiểm tra quyền dịch vụ (Lái hộ vs Taxi)
        if (pairingData.serviceType === 'FOR_HIRE' && driver.serviceType === 'RIDE_HAILING') {
          return socket.emit('trip:error', { message: 'Mã này dành cho dịch vụ Lái hộ. Bạn không có quyền nhận.' });
        }
        if (pairingData.serviceType === 'RIDE_HAILING' && driver.serviceType === 'FOR_HIRE') {
          return socket.emit('trip:error', { message: 'Mã này dành cho dịch vụ Đặt xe. Bạn không có quyền nhận.' });
        }

        // Kiểm tra loại xe (Xe máy vs Ô tô)
        const driverVehicle = driver.vehicles?.[0] || await prisma.driverVehicle.findFirst({ where: { driverId: driver.id, isDefault: true } });
        
        // Chỉ kiểm tra loại xe nghiêm ngặt đối với dịch vụ Đặt xe (RIDE_HAILING)
        if (pairingData.serviceType === 'RIDE_HAILING' && pairingData.vehicleType && driverVehicle) {
          if (driverVehicle.type !== pairingData.vehicleType) {
            let typeName = "không xác định";
            if (pairingData.vehicleType === 'bike') typeName = 'Xe máy';
            else if (pairingData.vehicleType === 'car_4') typeName = 'Xe ô tô 4 chỗ';
            else if (pairingData.vehicleType === 'car_7') typeName = 'Xe ô tô 7 chỗ';

            return socket.emit('trip:error', { 
              message: `Mã này dành cho dịch vụ ${typeName}. Xe của bạn (${driverVehicle.type}) không phù hợp.` 
            });
          }
        }

        // Bỏ qua kiểm tra khoảng cách GPS theo yêu cầu

        const parsedDriverId = parseInt(driverId);

        // Tạo Trip chính thức trong DB
        const trip = await prisma.$transaction(async (tx) => {
          // Tối ưu: Upsert customer trước
          const customer = await tx.customer.upsert({
            where: { userId: pairingData.passengerId },
            update: {},
            create: { userId: pairingData.passengerId }
          });

          const newTrip = await tx.trip.create({
            data: {
              customerId: customer.id,
              driverId: parsedDriverId,
              pickupAddress: pairingData.pickupAddress,
              pickupLat: parseFloat(pairingData.pickupLat),
              pickupLng: parseFloat(pairingData.pickupLng),
              dropoffAddress: pairingData.dropoffAddress,
              dropoffLat: parseFloat(pairingData.dropoffLat),
              dropoffLng: parseFloat(pairingData.dropoffLng),
              distanceKm: parseFloat(pairingData.distance),
              durationEstimateMin: parseInt(pairingData.duration),
              priceEstimate: parseFloat(pairingData.price),
              serviceType: pairingData.serviceType || 'FOR_HIRE',
              status: 'accepted',
              conversation: { create: {} }
            },
            include: {
              driver: { 
                include: { 
                  user: { select: { fullName: true, phone: true, avatarUrl: true } },
                  vehicles: { where: { isDefault: true } }
                } 
              }
            }
          });

          // Cập nhật tài xế bận
          await tx.driver.update({
            where: { id: parsedDriverId },
            data: { isBusy: true }
          });

          return newTrip;
        }, { maxWait: 2000, timeout: 5000 }); // Giảm timeout để fail fast nếu DB nghẽn

        // Tối ưu: Song song hóa các tác vụ sau khi tạo trip thành công
        await Promise.all([
          redis.del(pairingKey),
          redis.del(`now_user_pairing:${pairingData.passengerId}`)
        ]);

        // Phản hồi cho tài xế trước để giảm lag UI
        socket.emit('trip:accept_success', { tripId: trip.id, trip });
        socket.join(`trip_${trip.id}`);

        // Các tác vụ nền không chặn luồng chính
        (async () => {
          try {
            // QUAN TRỌNG: Đẩy vào queue xử lý tài chính (Fix bug thiếu hụt so với luồng thường)
            tripTasksQueue.add('PROCESS_TRIP_ACCEPTANCE', {
              tripId: trip.id,
              passengerId: pairingData.passengerId,
              paymentMethod: 'CASH', // Safeway Now mặc định CASH hoặc xử lý sau
              finalPrice: parseFloat(pairingData.price),
              isSafewayNow: true
            });

            // Thông báo cho khách hàng qua phòng riêng
            io.to(`user_${pairingData.passengerId}`).emit('trip:accepted', {
              tripId: trip.id,
              driverName: trip.driver.user.fullName,
              driverPhone: trip.driver.user.phone,
              vehiclePlate: trip.driver.vehicles[0]?.plateNumber || "Đang cập nhật",
              serviceType: trip.serviceType
            });

            io.emit('admin:trip_updated', { tripId: trip.id, type: 'new_trip' });
            logger.info({ tripId: trip.id, pinCode }, '[SAFEWAY NOW] Connection success');
          } catch (e) {
            logger.error(e, '[SAFEWAY NOW] Error in background tasks');
          }
        })();

      } catch (error) {
        logger.error(error, '[SAFEWAY NOW] Verify error');
        socket.emit('trip:error', { message: 'Lỗi khi kết nối chuyến đi.' });
      }
    });

    // 3. Khách hàng hủy yêu cầu PIN
    socket.on('trip:cancel_now_code', async (data) => {
      const { passengerId } = data;
      const userKey = `now_user_pairing:${passengerId}`;
      const pinCode = await redis.get(userKey);
      if (pinCode) {
        await redis.del(`now_pairing:${pinCode}`);
        await redis.del(userKey);
        logger.info({ passengerId, pinCode }, '[SAFEWAY NOW] PIN Cancelled by user');
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
        
        // 1. Lấy thông tin người gửi và cuộc hội thoại song song để tối ưu tốc độ
        const [sender, conversation] = await Promise.all([
          prisma.user.findUnique({
            where: { id: parseInt(senderId) },
            select: { fullName: true, avatarUrl: true }
          }),
          prisma.conversation.findUnique({
            where: { tripId: parseInt(tripId) }
          })
        ]);

        if (!conversation) {
          logger.error({ tripId }, '[CHAT ERROR] Conversation not found');
          return;
        }

        if (!sender) {
          logger.error({ senderId }, '[CHAT ERROR] Sender not found');
          return;
        }

        // 2. Chuẩn bị message để gửi đi ngay lập tức (Socket First)
        // Lưu ý: Message này chưa có ID từ Database, dựa vào tempId để Frontend nhận diện
        const messageToEmit = {
          senderId: parseInt(senderId),
          content: content,
          messageType: messageType,
          fileUrl: fileUrl || null,
          tempId,
          tripId: parseInt(tripId),
          createdAt: new Date(),
          sender: {
            fullName: sender.fullName,
            avatarUrl: sender.avatarUrl
          }
        };

        // 3. Emit ngay lập tức cho các bên
        logger.debug({ tripId, tempId }, '[CHAT] Emitting message before DB save');
        io.to(`trip_${tripId}`).to(`chat_${tripId}`).emit('chat:receive_message', messageToEmit);
        io.to(`trip_${tripId}`).to(`chat_${tripId}`).emit('chat:new_message', messageToEmit);

        // 4. Thực hiện các tác vụ nặng (Lưu DB, Gửi thông báo đẩy) trong nền (Background)
        (async () => {
          try {
            // Lưu vào DB
            const dbMessage = await prisma.message.create({
              data: {
                conversationId: conversation.id,
                senderId: parseInt(senderId),
                content: content,
                messageType: messageType,
                fileUrl: fileUrl || null,
              }
            });

            logger.info({ messageId: dbMessage.id, tempId }, '[CHAT] Message saved to DB successfully');

            // Gửi thông báo đẩy
            const trip = await prisma.trip.findUnique({
              where: { id: parseInt(tripId) },
              include: {
                customer: { select: { userId: true } },
                driver: { select: { userId: true } }
              }
            });

            if (trip) {
              const recipientId = (parseInt(senderId) === trip.customer.userId) 
                ? trip.driver?.userId 
                : trip.customer.userId;

              if (recipientId) {
                const senderName = sender.fullName || 'Ai đó';
                const pickup = trip.pickupAddress || 'chuyến đi';
                const notificationService = (await import('./notification.service.js')).default;
                await notificationService.createNotification(
                  recipientId,
                  'Tin nhắn mới',
                  `${senderName} nhắn cho bạn từ [${pickup}]: ${content || 'Đã gửi một hình ảnh'}`,
                  'CHAT',
                  { tripId: parseInt(tripId) }
                );
              }
            }
          } catch (bgErr) {
            logger.error(bgErr, '[CHAT BACKGROUND ERROR] Failed to save message or send notification');
          }
        })();

      } catch (error) {
        logger.error(error, '[CHAT ERROR] Global error in send_message');
      }
    });

    // Admin: Gửi tin nhắn can thiệp/hỗ trợ
    socket.on('admin:send_chat', async (data) => {
      try {
        const { tripId, senderId, content } = data;
        logger.info({ tripId, senderId }, '[ADMIN CHAT] Sending support message');

        // 1. Đảm bảo có cuộc hội thoại
        let conversation = await prisma.conversation.findUnique({
          where: { tripId: parseInt(tripId) }
        });

        if (!conversation) {
          conversation = await prisma.conversation.create({
            data: { tripId: parseInt(tripId) }
          });
        }

        // 2. Lưu tin nhắn vào DB với tiền tố [HỆ THỐNG]
        const dbMessage = await prisma.message.create({
          data: {
            conversationId: conversation.id,
            senderId: parseInt(senderId),
            content: `[HỆ THỐNG]: ${content}`,
            messageType: 'text'
          },
          include: {
            sender: {
              select: { fullName: true, avatarUrl: true }
            }
          }
        });

        // 3. Phát cho tất cả mọi người trong trip (bao gồm Admin, Tài xế, Khách hàng)
        const payload = {
           ...dbMessage,
           tripId: parseInt(tripId)
        };
        
        io.to(`trip_${tripId}`).to(`chat_${tripId}`).emit('chat:receive_message', payload);
        io.to(`trip_${tripId}`).to(`chat_${tripId}`).emit('chat:new_message', payload);
        
        logger.info({ messageId: dbMessage.id }, '[ADMIN CHAT] Broadcasted successfully');

      } catch (err) {
        logger.error(err, '[ADMIN CHAT ERROR]');
        socket.emit('admin:error', { message: 'Không thể gửi tin nhắn hỗ trợ.' });
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
        try {
          const activeSockets = await io.in(room).fetchSockets();
          if (activeSockets.length === 0) {
            logger.info({ driverId }, '[SOCKET] Driver offline (No active sockets)');
            
            // 1. Cập nhật DB
            await prisma.driver.update({
          where: { id: actualDriverId },
          data: { isOnline: true },
        }).catch(err => logger.error(err, 'Error updating driver online status'));

        // 3. KHÔI PHỤC VỊ TRÍ TỨC THÌ (Nếu có trong Cache)
        const lastLocStr = await redis.get(`driver:${actualDriverId}:last_location`);
        if (lastLocStr) {
          try {
            const lastLoc = JSON.parse(lastLocStr);
            await redis.geoadd('drivers:locations', lastLoc.lng, lastLoc.lat, actualDriverId);
            logger.info({ driverId: actualDriverId }, '[SOCKET] Driver location restored from cache on register');
          } catch (e) {
            logger.error(e, 'Error restoring driver location from cache');
          }
        }

            // 2. XÓA VỊ TRÍ TRONG REDIS (Quan trọng!)
            await redis.zrem('drivers:locations', driverId);
            
            // 3. Xóa cache vị trí cuối
            await redis.del(`driver:${driverId}:last_location`);

            // 4. Đóng phiên online
            await prisma.onlineSession.updateMany({
              where: { driverId: driverId, endTime: null },
              data: { endTime: new Date() }
            }).catch(err => logger.error('[SOCKET] Error ending online session:', err.message));
          }
        } catch (e) {
          logger.error(e, "[SOCKET] Error during driver cleanup");
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
export const emitToAdmins = (event, data) => {
  if (!io) return;
  // Mặc định io.emit sẽ gửi tới tất cả các client (bao gồm admin)
  io.emit(event, data);
};
