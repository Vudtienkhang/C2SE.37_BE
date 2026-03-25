import express from 'express';
import * as controller from '../controllers/pricingConfig.controller.js';

const router = express.Router();

router.get('/', controller.getAllPricingConfigs);
router.get('/:id', controller.getPricingConfigById);
router.post('/', controller.createPricingConfig);
router.put('/:id', controller.updatePricingConfig);
router.delete('/:id', controller.deletePricingConfig);
router.post('/calculate', controller.calculatePrice);
router.get('/weather-status', controller.getWeatherStatus);

export default router;
