import express from 'express';
import * as tripController from '../controllers/trip.controller.js';
import { verifyToken } from '../middlewares/auth.middleware.js';

const router = express.Router();

router.get('/:id', verifyToken, tripController.getTripById);
router.get('/history/:userId', tripController.getTripHistory);
router.get('/current/:userId', tripController.getCurrentTrip);
router.get('/share-public', tripController.getPublicTrip);
router.post('/:id/share', tripController.shareTrip);
//router.get('/:id', tripController.getTripById);

export default router;
