import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

export const getTripById = async (req, res) => {
  try {
    const { id } = req.params;
    const trip = await prisma.trip.findUnique({
      where: { id: parseInt(id) },
      include: {
        customer: { include: { user: true } },
        driver: { include: { user: true } },
        vehicle: true
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

export const getCurrentTrip = async (req, res) => {
  try {
    const userId = req.user.id;
    
    // Find customer by user ID
    const customer = await prisma.customer.findUnique({
      where: { userId }
    });

    if (!customer) {
      return res.status(404).json({ message: 'Không tìm thấy thông tin khách hàng' });
    }

    // Find the latest ongoing trip for this customer
    const currentTrip = await prisma.trip.findFirst({
      where: {
        customerId: customer.id,
        status: {
          in: ['requested', 'accepted', 'started']
        }
      },
      include: {
        driver: {
          include: {
            user: true,
            DriverRank: true
          }
        },
        vehicle: true
      },
      orderBy: {
        createdAt: 'desc'
      }
    });

    if (!currentTrip) {
        // Not considered an error, just return null or empty object indicating no active trip
        return res.json(null);
    }

    res.json(currentTrip);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

export const getTripHistory = async (req, res) => {
  try {
    const userId = req.user.id;
    
    // Find customer by user ID
    const customer = await prisma.customer.findUnique({
      where: { userId }
    });

    if (!customer) {
      return res.status(404).json({ message: 'Không tìm thấy thông tin khách hàng' });
    }

    // Find all completed or cancelled trips for this customer
    const historyTrips = await prisma.trip.findMany({
      where: {
        customerId: customer.id,
        status: {
          in: ['completed', 'cancelled']
        }
      },
      include: {
        driver: {
          include: {
            user: true
          }
        }
      },
      orderBy: {
        createdAt: 'desc'
      }
    });

    res.json(historyTrips);
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};
