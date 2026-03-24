import express from 'express';
import notificationController from '../controllers/notification.controller.js';
// Giả sử có middleware auth để lấy user từ token
// import { authenticateToken } from '../middlewares/auth.middleware.js';

const router = express.Router();

// Lấy danh sách thông báo (Ở đây có thể thêm auth middleware tùy kiến trúc)
router.get('/', (req, res) => notificationController.getNotifications(req, res));

// Đánh dấu đã đọc
router.patch('/:id/read', (req, res) => notificationController.markRead(req, res));

// Xóa thông báo
router.delete('/:id', (req, res) => notificationController.deleteNotification(req, res));

// Gửi thông báo (Dành cho Admin hoặc System)
router.post('/send', (req, res) => notificationController.sendNotification(req, res));

export default router;
