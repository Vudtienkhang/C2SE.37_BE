import express from 'express';
import * as reviewController from '../controllers/review.controller.js';

const router = express.Router();

// Tạo đánh giá mới
router.post('/', reviewController.createReview);

export default router;
