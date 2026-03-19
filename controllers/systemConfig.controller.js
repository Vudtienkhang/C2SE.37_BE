import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

export const getSystemConfig = async (req, res) => {
  try {
    const { key } = req.params;
    const config = await prisma.systemConfig.findUnique({
      where: { key }
    });
    if (!config) {
      return res.status(404).json({ success: false, message: 'Configuration not found' });
    }
    res.status(200).json({ success: true, data: config });
  } catch (error) {
    console.error('Error in getSystemConfig:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};

export const updateSystemConfig = async (req, res) => {
  try {
    const { key } = req.params;
    const { value, description } = req.body;

    const config = await prisma.systemConfig.upsert({
      where: { key },
      update: { value, description },
      create: { key, value, description }
    });

    // If updating default_commission, update all DriverRank records too
    if (key === 'default_commission') {
      const rate = parseFloat(value);
      if (!isNaN(rate)) {
        await prisma.driverRank.updateMany({
          data: {
            driverRate: rate,
            platformRate: 100 - rate
          }
        });
        console.log(`Synchronized all DriverRanks to ${rate}/${100 - rate}`);
      }
    }

    res.status(200).json({ success: true, data: config });
  } catch (error) {
    console.error('Error in updateSystemConfig:', error);
    res.status(500).json({ success: false, message: 'Internal server error' });
  }
};
