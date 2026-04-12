import prisma from '../prisma/prisma.js';
import { getIO } from './socket.service.js';

class NotificationService {
  /**
   * Tạo thông báo mới và gửi qua socket
   */
  async createNotification(userId, title, content, type = 'INFO', data = null) {
    try {
      const notification = await prisma.notification.create({
        data: {
          userId: parseInt(userId),
          title,
          content,
          type,
          data: typeof data === 'object' ? JSON.stringify(data) : data,
        },
      });

      // Phát sự kiện real-time qua socket tới room của người dùng
      try {
        const io = getIO();
        const roomName = `user_${userId}`;
        io.to(roomName).emit('notification:new', notification);
        // console.log(`[NOTIFICATION] Emitted to room ${roomName}`);
      } catch (socketError) {
        console.warn(`[NOTIFICATION] Socket emit failed for User ${userId}:`, socketError.message);
      }

      return notification;
    } catch (error) {
      console.error('[NOTIFICATION SERVICE] Error creating notification:', error);
      throw error;
    }
  }

  /**
   * Gửi thông báo tới tài xế dựa trên driverId
   */
  async notifyDriver(driverId, title, content, type = 'INFO') {
    const driver = await prisma.driver.findUnique({
      where: { id: parseInt(driverId) },
      select: { userId: true },
    });

    if (!driver) {
      throw new Error(`Driver with ID ${driverId} not found`);
    }

    return this.createNotification(driver.userId, title, content, type);
  }

  /**
   * Gửi thông báo tới khách hàng dựa trên customerId
   */
  async notifyCustomer(customerId, title, content, type = 'INFO') {
    const customer = await prisma.customer.findUnique({
      where: { id: parseInt(customerId) },
      select: { userId: true },
    });

    if (!customer) {
      throw new Error(`Customer with ID ${customerId} not found`);
    }

    return this.createNotification(customer.userId, title, content, type);
  }

  /**
   * Gửi thông báo tới DANH SÁCH người dùng
   */
  async notifyUsers(userIds, title, content, type = 'INFO') {
    if (!Array.isArray(userIds)) userIds = [userIds];
    const notifications = await Promise.all(
      userIds.map((uid) => this.createNotification(uid, title, content, type))
    );
    return { count: notifications.length };
  }

  /**
   * Gửi thông báo tới TẤT CẢ Tài xế
   */
  async notifyAllDrivers(title, content, type = 'INFO') {
    const drivers = await prisma.driver.findMany({ select: { userId: true } });
    const notifications = await Promise.all(
      drivers.map((d) => this.createNotification(d.userId, title, content, type))
    );
    return { count: notifications.length };
  }

  /**
   * Gửi thông báo tới TẤT CẢ Khách hàng
   */
  async notifyAllCustomers(title, content, type = 'INFO') {
    const customers = await prisma.customer.findMany({ select: { userId: true } });
    const notifications = await Promise.all(
      customers.map((c) => this.createNotification(c.userId, title, content, type))
    );
    return { count: notifications.length };
  }

  /**
   * Gửi thông báo tới TẤT CẢ người dùng
   */
  async notifyAll(title, content, type = 'INFO') {
    const users = await prisma.user.findMany({ select: { id: true } });
    const notifications = await Promise.all(
      users.map((user) => this.createNotification(user.id, title, content, type))
    );
    return { count: notifications.length };
  }

  /**
   * Lấy danh sách thông báo (Tất cả hoặc theo người dùng)
   */
  async getNotifications(userId = null) {
    const where = userId ? { userId: parseInt(userId) } : {};
    return prisma.notification.findMany({
      where,
      include: { user: { select: { fullName: true, phone: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Đánh dấu thông báo đã đọc
   */
  async markAsRead(notificationId) {
    return prisma.notification.update({
      where: { id: parseInt(notificationId) },
      data: { isRead: true },
    });
  }

  /**
   * Xóa thông báo
   */
  async deleteNotification(notificationId) {
    return prisma.notification.delete({
      where: { id: parseInt(notificationId) },
    });
  }
}

export default new NotificationService();
