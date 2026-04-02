import express from 'express';
import * as sosController from '../controllers/sos.controller.js';

const router = express.Router();

router.get('/', sosController.getAllAlerts);
router.patch('/:id/resolve', sosController.resolveAlert);

export default router;
