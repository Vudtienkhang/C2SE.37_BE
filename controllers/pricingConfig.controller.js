import prisma from '../prisma/prisma.js';

import * as pricingService from '../services/pricing.service.js';

export const getAllPricingConfigs = async (req, res) => {
  try {
    const configs = await prisma.pricingConfig.findMany({
      orderBy: { updatedAt: 'desc' }
    });
    res.status(200).json({ success: true, data: configs });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const getPricingConfigById = async (req, res) => {
  try {
    const { id } = req.params;
    const config = await prisma.pricingConfig.findUnique({
      where: { id: parseInt(id) }
    });
    if (!config) return res.status(404).json({ success: false, message: 'Config not found' });
    res.status(200).json({ success: true, data: config });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const createPricingConfig = async (req, res) => {
  try {
    const data = req.body;
    
    if (data.isActive === true || data.isActive === 'true') {
      await pricingService.deactivateOtherConfigs(data.vehicleType, data.serviceType || 'FOR_HIRE');
    }

    const newConfig = await prisma.pricingConfig.create({
      data: {
        ...data,
        perKmPrice: parseFloat(data.perKmPrice || 12000),
        holidayMultiplier: parseFloat(data.holidayMultiplier || 1.0),
        nightMultiplier: parseFloat(data.nightMultiplier || 1.3),
        rushHourMultiplier: parseFloat(data.rushHourMultiplier || 1.2),
        badWeatherFee: parseFloat(data.badWeatherFee || 0),
        systemFee: parseFloat(data.systemFee || 2000),
        isActive: data.isActive === true || data.isActive === 'true'
      }
    });

    res.status(201).json({ success: true, data: newConfig });
  } catch (error) {
    if (error.code !== 'P2002') {
      console.error('Create Pricing Config Error:', error);
    }
    if (error.code === 'P2002') {
      return res.status(400).json({ success: false, message: 'Tên cấu hình đã tồn tại. Vui lòng chọn tên khác.' });
    }
    res.status(400).json({ success: false, message: error.message || 'Lỗi khi tạo cấu hình' });
  }
};


export const updatePricingConfig = async (req, res) => {
  try {
    const { id } = req.params;
    const data = req.body;

    if (data.isActive === true || data.isActive === 'true') {
      const currentConfig = await prisma.pricingConfig.findUnique({ where: { id: parseInt(id) } });
      await pricingService.deactivateOtherConfigs(data.vehicleType || currentConfig.vehicleType, data.serviceType || currentConfig.serviceType);
    }

    const updatedConfig = await prisma.pricingConfig.update({
      where: { id: parseInt(id) },
      data: {
        ...data,
        perKmPrice: data.perKmPrice ? parseFloat(data.perKmPrice) : undefined,
        holidayMultiplier: data.holidayMultiplier ? parseFloat(data.holidayMultiplier) : undefined,
        nightMultiplier: data.nightMultiplier ? parseFloat(data.nightMultiplier) : undefined,
        rushHourMultiplier: data.rushHourMultiplier ? parseFloat(data.rushHourMultiplier) : undefined,
        badWeatherFee: data.badWeatherFee ? parseFloat(data.badWeatherFee) : undefined,
        systemFee: data.systemFee ? parseFloat(data.systemFee) : undefined,
        isActive: data.isActive !== undefined ? (data.isActive === true || data.isActive === 'true') : undefined
      }
    });

    res.status(200).json({ success: true, data: updatedConfig });
  } catch (error) {
    if (error.code !== 'P2002') {
      console.error('Update Pricing Config Error:', error);
    }
    if (error.code === 'P2002') {
      return res.status(400).json({ success: false, message: 'Tên cấu hình đã tồn tại. Vui lòng chọn tên khác.' });
    }
    res.status(400).json({ success: false, message: error.message || 'Lỗi khi cập nhật cấu hình' });
  }
};


export const deletePricingConfig = async (req, res) => {
  try {
    const { id } = req.params;
    await prisma.pricingConfig.delete({
      where: { id: parseInt(id) }
    });
    res.status(200).json({ success: true, message: 'Deleted successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const calculatePrice = async (req, res) => {
  try {
    const { distanceKm, durationMin, vehicleType, serviceType, pickupLat, pickupLng, weather } = req.body;
    
    if (distanceKm === undefined || durationMin === undefined || !vehicleType) {
      return res.status(400).json({ success: false, message: 'Missing required parameters' });
    }

    const priceResult = await pricingService.calculateTripPrice({
      distanceKm: parseFloat(distanceKm),
      durationMin: parseFloat(durationMin),
      vehicleType,
      serviceType,
      pickupLat: pickupLat ? parseFloat(pickupLat) : undefined,
      pickupLng: pickupLng ? parseFloat(pickupLng) : undefined,
      weather: weather || 'auto'
    });
    
    res.status(200).json({ success: true, data: priceResult });
  } catch (error) {
    console.error('Calculate Price Error:', error);
    res.status(500).json({ success: false, message: error.message });
  }
};


export const getWeatherStatus = async (req, res) => {
  try {
    const weatherData = await pricingService.getWeatherStatus();
    res.status(200).json({ success: true, data: weatherData });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
