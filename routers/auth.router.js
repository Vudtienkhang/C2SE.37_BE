import { Router } from 'express';
import * as authController from '../controllers/auth.controler.js';

const router = Router();

// Route POST /api/auth/register
router.post('/register', authController.register);

export default router;
