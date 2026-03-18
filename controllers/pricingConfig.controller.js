import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

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
      await pricingService.deactivateOtherConfigs(data.vehicleType);
    }

    const newConfig = await prisma.pricingConfig.create({
      data: {
        ...data,
        perKmPrice: parseFloat(data.perKmPrice),
        perMinPrice: parseFloat(data.perMinPrice),
        nightMultiplier: parseFloat(data.nightMultiplier),
        rushHourMultiplier: parseFloat(data.rushHourMultiplier),
        badWeatherFee: parseFloat(data.badWeatherFee),
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
      await pricingService.deactivateOtherConfigs(data.vehicleType || currentConfig.vehicleType);
    }

    const updatedConfig = await prisma.pricingConfig.update({
      where: { id: parseInt(id) },
      data: {
        ...data,
        perKmPrice: data.perKmPrice ? parseFloat(data.perKmPrice) : undefined,
        perMinPrice: data.perMinPrice ? parseFloat(data.perMinPrice) : undefined,
        nightMultiplier: data.nightMultiplier ? parseFloat(data.nightMultiplier) : undefined,
        rushHourMultiplier: data.rushHourMultiplier ? parseFloat(data.rushHourMultiplier) : undefined,
        badWeatherFee: data.badWeatherFee ? parseFloat(data.badWeatherFee) : undefined,
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

export const getWeatherStatus = async (req, res) => {
  try {
    const weatherData = await pricingService.getWeatherStatus();
    res.status(200).json({ success: true, data: weatherData });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
