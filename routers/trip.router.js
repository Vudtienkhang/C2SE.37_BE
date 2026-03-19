import express from 'express';
import * as tripController from '../controllers/trip.controller.js';

const router = express.Router();

router.get('/:id', tripController.getTripById);

export default router;
