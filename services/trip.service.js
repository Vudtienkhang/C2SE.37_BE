import prisma from '../prisma/prisma.js';
import crypto from 'crypto';

const SECRET_KEY = process.env.JWT_SECRET || 'safeway_super_secret_key';

/**
 * Lấy lịch sử chuyến đi của người dùng (khách hàng hoặc tài xế)
 * @param {number} userId - ID của người dùng
 * @returns {Promise<Array>} - Danh sách các chuyến đi đã hoàn thành hoặc bị hủy
 */
export const fetchTripHistory = async (userId) => {
  const id = parseInt(userId);

  const user = await prisma.user.findUnique({
    where: { id },
    include: {
      customer: true,
      driver: true,
    },
  });

  if (!user) {
    throw new Error('Không tìm thấy người dùng');
  }

  return await prisma.trip.findMany({
    where: {
      OR: [
        { customerId: user.customer?.id || -1 },
        { driverId: user.driver?.id || -1 },
      ],
      status: { in: ['completed', 'cancelled'] },
    },
    include: {
      customer: { include: { user: true } },
      driver: { include: { user: true } },
      vehicle: true,
      payments: true, // Bổ sung để hiện phương thức thanh toán
      review: true,
    },
    orderBy: { createdAt: 'desc' },
  });
};

/**
 * Lấy chuyến đi đang hoạt động của người dùng
 * @param {number} userId - ID của người dùng
 * @returns {Promise<Object|null>} - Chuyến đi đang hoạt động hoặc null
 */
export const fetchCurrentTrip = async (userId) => {
  const id = parseInt(userId);

  const user = await prisma.user.findUnique({
    where: { id },
    include: {
      customer: true,
      driver: true,
    },
  });

  if (!user) {
    throw new Error('Không tìm thấy người dùng');
  }

  return await prisma.trip.findFirst({
    where: {
      OR: [
        { customerId: user.customer?.id || -1 },
        { driverId: user.driver?.id || -1 },
      ],
      status: { notIn: ['completed', 'cancelled'] },
    },
    include: {
      customer: { include: { user: true } },
      driver: { include: { user: true } },
      vehicle: true,
      payments: true, // Quan trọng để App biết là Ví hay Tiền mặt
    },
    orderBy: { createdAt: 'desc' },
  });
};

/**
 * Lấy chi tiết chuyến đi theo ID
 * @param {number} tripId - ID của chuyến đi
 * @returns {Promise<Object|null>} - Chi tiết chuyến đi
 */
export const fetchTripById = async (tripId) => {
  return await prisma.trip.findUnique({
    where: { id: parseInt(tripId) },
    include: {
      customer: { include: { user: true } },
      driver: { include: { user: true } },
      vehicle: true,
      commissions: true,
      feeBreakdowns: true,
      payments: true,
      review: true,
      disputes: true,
      locationHistory: {
        orderBy: { createdAt: 'asc' }
      },
    },
  });
};

/**
 * Tạo chữ ký bảo mật cho chuyến đi (không dùng Database)
 * @param {number} tripId 
 * @returns {string} - Chữ ký (Token)
 */
export const generateTripSignature = (tripId) => {
  return crypto
    .createHmac('sha256', SECRET_KEY)
    .update(tripId.toString())
    .digest('hex');
};

/**
 * Lấy chuyến đi và xác thực chữ ký (Cho trang Web công khai)
 * @param {number} tripId 
 * @param {string} token 
 * @returns {Promise<Object|null>}
 */
export const verifyPublicTrip = async (tripId, token) => {
  const id = parseInt(tripId);
  const expectedToken = generateTripSignature(id);

  if (token !== expectedToken) {
    throw new Error('Mã xác thực không hợp lệ');
  }

  const trip = await prisma.trip.findUnique({
    where: { id },
    include: {
      customer: { select: { fullName: true, avatarUrl: true } },
      driver: { 
        include: { 
          user: { select: { fullName: true, phone: true, avatarUrl: true } }
        } 
      },
      vehicle: true,
    },
  });

  if (!trip) return null;

  // Chỉ cho phép xem nếu chưa hoàn thành hoặc hủy
  if (['completed', 'cancelled'].includes(trip.status)) {
    throw new Error('Chuyến đi đã kết thúc hoặc bị hủy');
  }

  return trip;
};
