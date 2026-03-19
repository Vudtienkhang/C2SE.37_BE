import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

export const getTripById = async (req, res) => {
  try {
    const { id } = req.params;
    const trip = await prisma.trip.findUnique({
      where: { id: parseInt(id) },
      include: {
        customer: { include: { user: true } },
        driver: { include: { user: true } }
      }
    });

    if (!trip) {
      return res.status(404).json({ message: 'Không tìm thấy chuyến đi' });
    }

    res.json(trip);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
