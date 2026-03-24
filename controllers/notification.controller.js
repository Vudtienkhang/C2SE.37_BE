import notificationService from '../services/notification.service.js';

class NotificationController {
  /**
   * Lấy danh sách thông báo của người dùng (từ JWT hoặc query params)
   */
  async getNotifications(req, res) {
    try {
      let { userId } = req.query;
      if (userId === 'undefined' || userId === 'null') userId = null;
      
      const notifications = await notificationService.getNotifications(userId);
      res.json(notifications);
    } catch (error) {
      res.status(500).json({ message: 'Lỗi khi lấy thông báo', error: error.message });
    }
  }

  /**
   * Đánh dấu thông báo đã đọc
   */
  async markRead(req, res) {
    try {
      const { id } = req.params;
      const notification = await notificationService.markAsRead(id);
      res.json(notification);
    } catch (error) {
      res.status(500).json({ message: 'Lỗi khi cập nhật trạng thái đã đọc', error: error.message });
    }
  }

  /**
   * Xóa thông báo
   */
  async deleteNotification(req, res) {
    try {
      const { id } = req.params;
      await notificationService.deleteNotification(id);
      res.json({ message: 'Xóa thông báo thành công' });
    } catch (error) {
      res.status(500).json({ message: 'Lỗi khi xóa thông báo', error: error.message });
    }
  }

  /**
   * API dành cho Admin hoặc hệ thống để gửi thông báo
   */
  async sendNotification(req, res) {
    try {
      const { userIds, userId, driverId, customerId, target, title, content, type } = req.body;

      let result;
      if (userIds && Array.isArray(userIds) && userIds.length > 0) {
        result = await notificationService.notifyUsers(userIds, title, content, type);
      } else if (target === 'all') {
        result = await notificationService.notifyAll(title, content, type);
      } else if (target === 'driver') {
        result = await notificationService.notifyAllDrivers(title, content, type);
      } else if (target === 'customer') {
        result = await notificationService.notifyAllCustomers(title, content, type);
      } else if (userId) {
        result = await notificationService.createNotification(userId, title, content, type);
      } else if (driverId) {
        result = await notificationService.notifyDriver(driverId, title, content, type);
      } else if (customerId) {
        result = await notificationService.notifyCustomer(customerId, title, content, type);
      } else {
        return res.status(400).json({ message: 'Cần cung cấp target, userId, driverId hoặc customerId' });
      }

      res.status(201).json(result);
    } catch (error) {
      res.status(500).json({ message: 'Lỗi khi gửi thông báo', error: error.message });
    }
  }
}

export default new NotificationController();
