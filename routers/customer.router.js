import express from 'express';
import { getMyVehicles, addVehicle } from '../controllers/customer.controller.js';

const router = express.Router();

router.get('/:userId/vehicles', getMyVehicles);
router.post('/:userId/vehicles', addVehicle);

export default router;