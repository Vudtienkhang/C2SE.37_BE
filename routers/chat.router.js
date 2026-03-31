import express from 'express';
import * as chatController from '../controllers/chat.controller.js';

const router = express.Router();

// Lấy tin nhắn theo tripId
router.get('/:tripId/messages', chatController.getMessagesByTripId);

// Đánh dấu đã đọc tất cả tin nhắn đối phương
router.put('/:tripId/read', chatController.markAsRead);

export default router;
