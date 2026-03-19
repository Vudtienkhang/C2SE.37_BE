import express from 'express';
import * as customerController from '../controllers/customer.controller.js';

const router = express.Router();

router.get('/:userId/vehicles', customerController.getVehiclesByUserId);

export default router;
