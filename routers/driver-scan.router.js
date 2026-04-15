import express from 'express';
import { findNearbyDrivers, updateStatus, verifyFace, checkEligibility } from '../controllers/driver-scan.controller.js';
import multer from 'multer';

const upload = multer({ storage: multer.memoryStorage() });

const router = express.Router();

router.get('/nearby', findNearbyDrivers);
router.get('/eligibility/:driverId', checkEligibility);
router.put('/status/:driverId', updateStatus);
router.post('/verify-face/:driverId', upload.single('faceImage'), verifyFace);


export default router;
