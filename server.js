import 'dotenv/config';
import http from 'http';
import app from './app.js';
import { assertDb } from './lib/db.js';
import { initSocket } from './services/socket.service.js';
import './services/queue.service.js'; 

const PORT = process.env.PORT || 5000;
const server = http.createServer(app);

// Khởi chạy Socket.io
initSocket(server);

server.listen(PORT, '0.0.0.0', async () => {
  await assertDb();
  console.log(`Server is running on port ${PORT}`);
});
