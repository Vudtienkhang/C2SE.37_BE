import express from 'express';
import * as chatController from '../controllers/chat.controller.js';
import { verifyToken } from '../middlewares/auth.middleware.js';

const router = express.Router();

// Lấy lịch sử tin nhắn
router.get('/:tripId/messages', verifyToken, chatController.getMessages);

// Đánh dấu đã đọc
router.patch('/messages/read', verifyToken, chatController.markMessagesAsRead);

export default router;
