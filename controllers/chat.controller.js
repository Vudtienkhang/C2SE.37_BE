import prisma from '../prisma/prisma.js';

export const getMessages = async (req, res) => {
  try {
    const { tripId } = req.params;
    
    const conversation = await prisma.conversation.findUnique({
      where: { tripId: parseInt(tripId) },
      include: {
        messages: {
          orderBy: { createdAt: 'asc' },
          include: {
            sender: {
              select: {
                id: true,
                fullName: true,
                avatarUrl: true,
                role: { select: { name: true } }
              }
            }
          }
        }
      }
    });

    if (!conversation) {
      return res.status(404).json({ message: 'Không tìm thấy cuộc hội thoại cho chuyến đi này' });
    }

    console.log(`[CHAT] Fetched ${conversation.messages.length} messages for trip ${tripId}`);
    res.json(conversation.messages);
  } catch (error) {
    console.error('Error fetching messages:', error);
    res.status(500).json({ message: 'Lỗi hệ thống khi lấy tin nhắn' });
  }
};

export const markMessagesAsRead = async (req, res) => {
  try {
    const { tripId } = req.body;
    const userId = req.user.id; // Giả sử đã có auth middleware

    const conversation = await prisma.conversation.findUnique({
      where: { tripId: parseInt(tripId) }
    });

    if (!conversation) return res.status(404).json({ message: 'Không tìm thấy hội thoại' });

    await prisma.message.updateMany({
      where: {
        conversationId: conversation.id,
        senderId: { not: userId },
        isRead: false
      },
      data: { isRead: true }
    });

    // Phát sự kiện qua socket để các màn hình khác cập nhật (ví dụ: mất chấm đỏ thông báo)
    const { getIO } = await import('../services/socket.service.js');
    const io = getIO();
    io.to(`trip_${tripId}`).emit('chat:messages_read', { tripId: parseInt(tripId), userId });

    res.json({ success: true });
  } catch (error) {
    console.error('Error marking messages as read:', error);
    res.status(500).json({ message: 'Lỗi hệ thống' });
  }
};
