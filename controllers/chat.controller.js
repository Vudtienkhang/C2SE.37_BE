import prisma from '../prisma/prisma.js';

/**
 * Lấy lịch sử tin nhắn của một cuộc hội thoại theo tripId
 */
export const getMessagesByTripId = async (req, res) => {
  try {
    const { tripId } = req.params;
    
    const conversation = await prisma.conversation.findUnique({
      where: { tripId: parseInt(tripId) },
      include: {
        messages: {
          take: 50, // Chỉ lấy 50 tin nhắn gần nhất để tối ưu tốc độ
          orderBy: { createdAt: 'desc' }, // Lấy từ mới nhất trở về sau
          include: {
            sender: {
              select: {
                id: true,
                fullName: true,
                avatarUrl: true
              }
            }
          }
        }
      }
    });

    if (!conversation) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy cuộc hội thoại cho chuyến đi này' });
    }

    // Đảo ngược lại để hiển thị đúng thứ tự thời gian trên App (cũ trên, mới dưới)
    const messages = conversation.messages.reverse();

    res.json({ success: true, data: messages });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

/**
 * Đánh dấu tất cả tin nhắn trong một cuộc hội thoại là đã đọc cho một người dùng cụ thể
 * (Người dùng đánh dấu tin nhắn của người KIA là đã đọc)
 */
export const markAsRead = async (req, res) => {
  try {
    const { tripId } = req.params;
    const { userId } = req.body;

    const conversation = await prisma.conversation.findUnique({
      where: { tripId: parseInt(tripId) }
    });

    if (!conversation) {
      return res.status(404).json({ success: false, message: 'Không tìm thấy cuộc hội thoại' });
    }

    await prisma.message.updateMany({
      where: {
        conversationId: conversation.id,
        senderId: { not: parseInt(userId) }, // Chỉ đánh dấu tin nhắn của người khác
        isRead: false
      },
      data: { isRead: true }
    });

    res.json({ success: true, message: 'Đã đánh dấu tất cả tin nhắn là đã đọc' });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};
