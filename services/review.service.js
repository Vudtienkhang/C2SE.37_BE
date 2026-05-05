import prisma from '../prisma/prisma.js';
import { getIO } from './socket.service.js';

/**
 * Tạo đánh giá và cập nhật rating tài xế
 * @param {Object} reviewData - Dữ liệu đánh giá
 */
export const createReview = async (reviewData) => {
  const { tripId, rating, comment, customerId, driverId } = reviewData;

  return await prisma.$transaction(async (tx) => {
    // 1. Tạo bản ghi Review
    const review = await tx.review.create({
      data: {
        tripId: parseInt(tripId),
        customerId: parseInt(customerId),
        driverId: driverId ? parseInt(driverId) : null,
        rating: parseInt(rating),
        comment: comment || '',
      },
    });

    // 2. Nếu có driverId, cập nhật ratingAvg cho tài xế
    if (driverId) {
      const stats = await tx.review.aggregate({
        where: { driverId: parseInt(driverId) },
        _avg: { rating: true },
        _count: { id: true },
      });

      await tx.driver.update({
        where: { id: parseInt(driverId) },
        data: {
          ratingAvg: stats._avg.rating || 0,
        },
      });
    }

    // Phát sự kiện cho Admins
    try {
        const io = getIO();
        if (io) io.emit('admin:new_review', { tripId: review.tripId, rating: review.rating });
    } catch (err) {
        console.warn('Socket emit failed in createReview');
    }

    return review;
  });
};

/**
 * Lấy danh sách đánh giá với bộ lọc và tìm kiếm dành cho Admin
 * @param {Object} params - Các tham số lọc (page, limit, search, rating)
 */
export const getReviews = async ({ page = 1, limit = 10, search = '', rating = 'all' }) => {
  const skip = (page - 1) * limit;
  const take = parseInt(limit);

  const where = {
    AND: []
  };

  // Lọc theo rating nếu không phải 'all'
  if (rating !== 'all' && rating !== '') {
    where.AND.push({ rating: parseInt(rating) });
  }

  // Tìm kiếm theo tên khách hàng, tên tài xế hoặc nội dung đánh giá
  if (search) {
    where.AND.push({
      OR: [
        { customer: { fullName: { contains: search, mode: 'insensitive' } } },
        { driver: { fullName: { contains: search, mode: 'insensitive' } } },
        { comment: { contains: search, mode: 'insensitive' } },
        // Tìm theo Trip ID nếu search là số
        ...(!isNaN(parseInt(search)) ? [{ tripId: parseInt(search) }] : [])
      ],
    });
  }

  const [total, reviews] = await Promise.all([
    prisma.review.count({ where }),
    prisma.review.findMany({
      where,
      include: {
        customer: {
          select: {
            id: true,
            fullName: true,
            avatarUrl: true
          }
        },
        driver: {
          select: {
            id: true,
            fullName: true,
            avatarUrl: true
          }
        },
        trip: {
          select: {
            id: true,
            pickupAddress: true,
            dropoffAddress: true,
            createdAt: true
          }
        }
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take,
    }),
  ]);

  return {
    reviews,
    pagination: {
      total,
      page: parseInt(page),
      limit: take,
      totalPages: Math.ceil(total / take),
    },
  };
};
