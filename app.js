import express from 'express';
import cors from 'cors';

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Routers
import authRouter from './routers/auth.router.js';
import uploadRouter from './routers/upload.router.js';

app.use('/api/auth', authRouter);
app.use('/api/auth', uploadRouter);

// Base route
app.get('/', (req, res) => {
  res.send('API is running...');
});

export default app;