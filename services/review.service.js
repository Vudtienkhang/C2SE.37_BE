import prisma from '../prisma/prisma.js';

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

    return review;
  });
};
