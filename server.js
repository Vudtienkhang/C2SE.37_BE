import 'dotenv/config';
import http from 'http';
import app from './app.js';
import { initSocket } from './services/socket.service.js';
import { assertDb } from './lib/db.js';
import logger from './lib/logger.js';
import './services/queue.service.js'; // Khởi chạy Background Worker

const PORT = process.env.PORT || 5000;
const server = http.createServer(app);

// Khởi chạy Socket.io
initSocket(server);

server.listen(PORT, '0.0.0.0', async () => {
  await assertDb();
  logger.info(`Server is running on port ${PORT}`);
});
