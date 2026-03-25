import * as reviewService from '../services/review.service.js';

/**
 * Tạo đánh giá mới cho chuyến đi
 * @param {Object} req - Request object (tripId, rating, comment, customerId, driverId)
 * @param {Object} res - Response object
 */
export const createReview = async (req, res) => {
  try {
    const { tripId, rating, comment, customerId, driverId } = req.body;

    if (!tripId || !rating || !customerId) {
      return res.status(400).json({ success: false, message: 'Thiếu thông tin đánh giá bắt buộc' });
    }

    const result = await reviewService.createReview({
      tripId, rating, comment, customerId, driverId
    });

    res.status(201).json({ success: true, data: result });
  } catch (error) {
    console.error('Create review error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};
