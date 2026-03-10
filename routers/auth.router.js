import { Router } from 'express';
import * as authController from '../controllers/auth.controler.js';

const router = Router();

// Route POST /api/auth/register
router.post('/register', authController.register);
// Route POST /api/auth/login
router.post('/login', authController.login);

// Route GET /api/auth/profile/:id
router.get('/profile/:id', authController.getUserProfile);

export default router;
