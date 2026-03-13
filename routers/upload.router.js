import { Router } from 'express';
import multer from 'multer';
import { uploadAvatar } from "../controllers/upload.controller.js";

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

// Route POST /api/auth/profile/:id/avatar
router.post('/profile/:id/avatar', upload.single('avatar'), uploadAvatar);

export default router;