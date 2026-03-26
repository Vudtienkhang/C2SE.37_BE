import { Queue } from 'bullmq';
import redis from './redis.js';

export const tripTasksQueue = new Queue('trip-tasks', {
  connection: redis
});

console.log('[QUEUE] Trip Tasks Queue initialized');
