import prisma from '../prisma/prisma.js';

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
      review: true,
      disputes: true,
    },
  });
};
