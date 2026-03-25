import express from 'express';
import * as tripController from '../controllers/trip.controller.js';

const router = express.Router();

router.get('/history/:userId', tripController.getTripHistory);
router.get('/current/:userId', tripController.getCurrentTrip);
router.get('/:id', tripController.getTripById);

export default router;
