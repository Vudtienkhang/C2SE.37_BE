import express from 'express';
import { getMyVehicles, addVehicle, setDefaultVehicle } from '../controllers/customer.controller.js';

const router = express.Router();

router.get('/:userId/vehicles', getMyVehicles);
router.post('/:userId/vehicles', addVehicle);
router.put('/:userId/vehicles/:vehicleId/default', setDefaultVehicle);

export default router;