import express from 'express';
import * as holidayController from '../controllers/holiday.controller.js';

const router = express.Router();

router.get('/', holidayController.getAllHolidays);
router.post('/', holidayController.createHoliday);
router.put('/:id', holidayController.updateHoliday);
router.delete('/:id', holidayController.deleteHoliday);

export default router;
