import express from 'express';
import { verifyToken } from '../middlewares/auth.middleware.js';
import driverTestController from '../controllers/driver.test.controller.js';

const router = express.Router();

router.use(verifyToken);

router.post('/start', driverTestController.startTest);
router.get('/remaining/:sessionId', driverTestController.getRemainingQuestions);
router.post('/submit', driverTestController.submitTest);

export default router;
