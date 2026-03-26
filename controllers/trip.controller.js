import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();

export const getTripById = async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user?.id;

    const trip = await prisma.trip.findUnique({
      where: { id: parseInt(id) },
      include: {
        customer: { include: { user: true } },
        driver: { include: { user: true } },
        vehicle: true,
        commissions: true,
        feeBreakdowns: true,
        conversation: {
          include: {
            _count: {
              select: {
                messages: {
                  where: {
                    senderId: { not: userId || 0 },
                    isRead: false
                  }
                }
              }
            }
          }
        }
      }
    });

    if (!trip) {
      return res.status(404).json({ message: 'Không tìm thấy chuyến đi' });
    }

    // Map unread count to a cleaner property
    const result = {
      ...trip,
      unreadMessageCount: trip.conversation?._count?.messages || 0
    };

    res.json(result);
  } catch (error) {
    console.error('Error in getTripById:', error);
    res.status(500).json({ message: error.message });
  }
};
