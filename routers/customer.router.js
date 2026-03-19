import express from 'express';
import { getMyVehicles, addVehicle, getVehiclesByUserId } from '../controllers/customer.controller.js';

const router = express.Router();

router.get('/:userId/vehicles', getMyVehicles);
router.post('/:userId/vehicles', addVehicle);
router.get('/:userId/vehicles', getVehiclesByUserId);

export default router;
