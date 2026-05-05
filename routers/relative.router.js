import express from 'express';
import { 
  getRelatives, 
  addRelative, 
  updateRelative, 
  deleteRelative 
} from '../controllers/relative.controller.js';

const router = express.Router();

router.get('/:userId', getRelatives);
router.post('/:userId', addRelative);
router.put('/:id', updateRelative);
router.delete('/:id', deleteRelative);

export default router;
