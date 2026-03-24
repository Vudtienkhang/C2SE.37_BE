import prisma from './prisma/prisma.js';
import notificationService from './services/notification.service.js';

async function test() {
  try {
    const user = await prisma.user.findFirst();
    if (!user) {
      console.log('No user found in DB, creating a dummy user...');
      // Skip dummy user creation for now, just log
      return;
    }

    console.log('Testing notification list for user:', user.id);
    const notes = await notificationService.getUserNotifications(user.id);
    console.log('Existing notifications:', notes.length);

    console.log('Creating test notification...');
    const newNote = await notificationService.createNotification(
      user.id,
      'Test Title',
      'This is a test notification content',
      'TEST'
    );
    console.log('Created:', newNote);

    console.log('Marking as read...');
    const updated = await notificationService.markAsRead(newNote.id);
    console.log('Updated:', updated.isRead);

    console.log('Deleting...');
    await notificationService.deleteNotification(newNote.id);
    console.log('Deleted successfully');

  } catch (error) {
    console.error('Test failed with error:', error);
    if (error.stack) {
      console.error(error.stack);
    }
  } finally {
    await prisma.$disconnect();
  }
}

test();
