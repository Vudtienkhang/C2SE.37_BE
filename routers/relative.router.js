import express from 'express';
import { 
  getRelatives, 
  addRelative, 
  updateRelative, 
  deleteRelative,
  getTrackingTrips
} from '../controllers/relative.controller.js';

import { verifyToken } from '../middlewares/auth.middleware.js';

const router = express.Router();

router.get('/tracking/:userId', verifyToken, getTrackingTrips);
router.get('/:userId', verifyToken, getRelatives);
router.post('/:userId', verifyToken, addRelative);
router.put('/:id', verifyToken, updateRelative);
router.delete('/:id', verifyToken, deleteRelative);

export default router;
