import * as tripService from '../services/trip.service.js';

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
    const trip = await tripService.fetchTripById(id);

    if (!trip) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy chuyến đi' });
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
    res.json({ success: true, data: trip });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const getTripHistory = async (req, res) => {
  try {
    const { userId } = req.params;
    const trips = await tripService.fetchTripHistory(userId);
    res.json({ success: true, data: trips });
  } catch (error) {
    const statusCode = error.message === 'Không tìm thấy người dùng' ? 404 : 500;
    res.status(statusCode).json({ success: false, message: error.message });
  }
};

export const getCurrentTrip = async (req, res) => {
  try {
    const { userId } = req.params;
    const trip = await tripService.fetchCurrentTrip(userId);
    res.json({ success: true, data: trip });
  } catch (error) {
    const statusCode = error.message === 'Không tìm thấy người dùng' ? 404 : 500;
    res.status(statusCode).json({ success: false, message: error.message });
  }
};

export const shareTrip = async (req, res) => {
  try {
    const { id } = req.params;
    const token = tripService.generateTripSignature(id);
    res.json({ success: true, data: { shareToken: token } });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

export const getPublicTrip = async (req, res) => {
  try {
    const { tripId, token } = req.query;
    const trip = await tripService.verifyPublicTrip(tripId, token);

    if (!trip) {
      return res.status(404).json({ success: false, message: 'Chuyến đi không tồn tại' });
    }

    res.json({ success: true, data: trip });
  } catch (error) {
    res.status(400).json({ success: false, message: error.message });
  }
};
