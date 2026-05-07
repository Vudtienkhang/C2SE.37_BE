import * as reviewService from '../services/review.service.js';
import { tripTasksQueue } from '../lib/queue.js';

/**
 * Tạo đánh giá mới cho chuyến đi
 * @param {Object} req - Request object (tripId, rating, comment, customerId, driverId)
 * @param {Object} res - Response object
 */
export const createReview = async (req, res) => {
  try {
    const { tripId, rating, comment, customerId, driverId, tipAmount } = req.body;

    if (!tripId || !rating || !customerId) {
      return res.status(400).json({ success: false, message: 'Thiếu thông tin đánh giá bắt buộc' });
    }

    const result = await reviewService.createReview({
      tripId, rating, comment, customerId, driverId, tipAmount
    });

    // TỐI ƯU: Đẩy việc tính điểm thưởng/phạt vào Queue
    if (driverId) {
      await tripTasksQueue.add('PROCESS_REVIEW_SCORE', {
        driverId: parseInt(driverId),
        rating: parseInt(rating),
        tripId: parseInt(tripId)
      });
    }

    res.status(201).json({ success: true, data: result });
  } catch (error) {
    console.error('Create review error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Lấy danh sách đánh giá (Dành cho Admin)
 */
export const getReviews = async (req, res) => {
  try {
    const { page, limit, search, rating } = req.query;
    const result = await reviewService.getReviews({
      page: parseInt(page) || 1,
      limit: parseInt(limit) || 10,
      search: search || '',
      rating: rating || 'all'
    });

    res.status(200).json({ success: true, ...result });
  } catch (error) {
    console.error('Get reviews error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};
