import prisma from '../prisma/prisma.js';

export const getAllHolidays = async (req, res) => {
  try {
    const holidays = await prisma.holidayConfig.findMany({
      orderBy: { startDate: 'asc' }
    });
    res.status(200).json({ success: true, data: holidays });

  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const createHoliday = async (req, res) => {
  try {
    const { name, startDate, endDate, multiplier, isActive } = req.body;
    
    const newHoliday = await prisma.holidayConfig.create({
      data: {
        name,
        startDate: new Date(startDate),
        endDate: new Date(endDate || startDate),
        multiplier: parseFloat(multiplier || 1.5),
        isActive: isActive !== undefined ? isActive : true
      }
    });

    res.status(201).json({ success: true, data: newHoliday });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });

  }
};

export const updateHoliday = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, startDate, endDate, multiplier, isActive } = req.body;

    const updated = await prisma.holidayConfig.update({
      where: { id: parseInt(id) },
      data: {
        name,
        startDate: startDate ? new Date(startDate) : undefined,
        endDate: endDate ? new Date(endDate) : undefined,
        multiplier: multiplier ? parseFloat(multiplier) : undefined,
        isActive: isActive !== undefined ? isActive : undefined
      }
    });


    res.status(200).json({ success: true, data: updated });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};

export const deleteHoliday = async (req, res) => {
  try {
    const { id } = req.params;
    await prisma.holidayConfig.delete({
      where: { id: parseInt(id) }
    });
    res.status(200).json({ success: true, message: 'Deleted successfully' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
