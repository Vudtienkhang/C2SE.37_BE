import { Router } from 'express';
import multer from 'multer';
import * as disputeController from '../controllers/dispute.controller.js';
import { verifyAdminToken, verifyToken } from '../middlewares/auth.middleware.js';


const router = Router();
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit per file
  }
});

// --- Public/Auth routes for creating and viewing own disputes ---
// POST /api/disputes - Tạo khiếu nại mới (kèm bằng chứng)
router.post('/', verifyToken, upload.array('evidence', 10), disputeController.createDispute);

// GET /api/disputes/my - Danh sách khiếu nại của chính tôi
router.get('/my', verifyToken, disputeController.getMyDisputes);

// GET /api/disputes/trip/:tripId - Xem lịch sử khiếu nại của 1 chuyến đi
router.get('/trip/:tripId', verifyToken, disputeController.getTripDisputes);

// --- Admin routes ---
// GET /disputes/pending-count - Đếm số lượng khiếu nại đang chờ (Admin)
router.get('/pending-count', verifyAdminToken, disputeController.getPendingCount);

// GET /api/disputes - Danh sách khiếu nại toàn hệ thống (Admin)
router.get('/', verifyAdminToken, disputeController.listAllDisputes);

// GET /api/disputes/:id - Xem chi tiết khiếu nại (Admin hoặc Chủ sở hữu)
router.get('/:id', verifyToken, disputeController.getDisputeDetail);

// PATCH /api/disputes/:id/status - Cập nhật trạng thái (Admin)
router.patch('/:id/status', verifyAdminToken, disputeController.updateStatus);

// POST /api/disputes/:id/resolve-refund - Hoàn tiền và đóng khiếu nại
router.post('/:id/resolve-refund', verifyAdminToken, disputeController.resolveRefund);

// POST /api/disputes/:id/resolve-penalty - Phạt tài xế và đóng khiếu nại
router.post('/:id/resolve-penalty', verifyAdminToken, disputeController.resolvePenalty);


export default router;
