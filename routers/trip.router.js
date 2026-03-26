import express from 'express';
import * as tripController from '../controllers/trip.controller.js';
import { verifyToken } from '../middlewares/auth.middleware.js';

const router = express.Router();

router.get('/:id', verifyToken, tripController.getTripById);

export default router;
