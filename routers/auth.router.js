import { Router } from 'express';
import * as authController from '../controllers/auth.controler.js';

const router = Router();

// Route POST /api/auth/register
router.post('/register', authController.register);
// Route POST /api/auth/login
router.post('/login', authController.login);

import multer from 'multer';

// Cấu hình multer để lưu file dưới dạng memory buffer
const upload = multer({ storage: multer.memoryStorage() });

// Route GET /api/auth/profile/:id
router.get('/profile/:id', authController.getUserProfile);
// Route PUT /api/auth/profile/:id
router.put('/profile/:id', authController.updateProfile);


export default router;
