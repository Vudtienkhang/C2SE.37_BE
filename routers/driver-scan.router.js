import express from 'express';
import { findNearbyDrivers, updateStatus } from '../controllers/driver-scan.controller.js';

const router = express.Router();

router.get('/nearby', findNearbyDrivers);
router.put('/status/:driverId', updateStatus);


export default router;
