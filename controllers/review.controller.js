import * as reviewService from '../services/review.service.js';
import { tripTasksQueue } from '../lib/queue.js';
import * as sentimentService from '../services/sentiment.service.js';
import { emitToAdmins } from '../services/socket.service.js';

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

    // Real-time notification for Admin
    emitToAdmins('admin:new_review', { 
      reviewId: result.id, 
      tripId, 
      rating, 
      comment,
      driverId 
    });

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
    const { page, limit, search, rating, analyzeAI } = req.query;
    const result = await reviewService.getReviews({
      page: parseInt(page) || 1,
      limit: parseInt(limit) || 10,
      search: search || '',
      rating: rating || 'all'
    });

    // Nếu Admin yêu cầu phân tích AI cho danh sách này
    if (analyzeAI === 'true' && result.reviews && result.reviews.length > 0) {
      const analyzedReviews = await Promise.all(
        result.reviews.map(async (review) => {
          if (review.comment && review.comment.trim()) {
            const aiResult = await sentimentService.analyzeSentiment(review.comment);
            return { ...review, aiSentiment: aiResult };
          }
          return { ...review, aiSentiment: { label: 'N/A', score: 0 } };
        })
      );
      result.reviews = analyzedReviews;
    }

    res.status(200).json({ success: true, ...result });
  } catch (error) {
    console.error('Get reviews error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};
