import * as reviewService from '../services/review.service.js';
import { tripTasksQueue } from '../lib/queue.js';

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
