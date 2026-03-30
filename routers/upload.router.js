import { Router } from 'express';
import multer from 'multer';
import { uploadAvatar, uploadDriverDocument } from "../controllers/upload.controller.js";

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

// Route POST /api/auth/profile/:id/avatar
router.post('/profile/:id/avatar', upload.single('avatar'), uploadAvatar);

// Route POST /api/auth/upload/driver-document/:userId/:documentTypeId
router.post('/driver-document/:userId/:documentTypeId', upload.single('document'), uploadDriverDocument);

export default router;