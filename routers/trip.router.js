import express from 'express';
import * as tripController from '../controllers/trip.controller.js';
import { verifyToken } from '../middlewares/auth.middleware.js';

const router = express.Router();

router.get('/current', verifyToken, tripController.getCurrentTrip);
router.get('/history', verifyToken, tripController.getTripHistory);
router.get('/:id', tripController.getTripById);

export default router;
