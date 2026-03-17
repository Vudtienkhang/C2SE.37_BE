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
import addressRouter from './routers/address.router.js';
import adminRouter from './routers/admin.router.js';
import pricingRouter from './routers/pricingConfig.router.js';


app.use('/api/auth', authRouter);
app.use('/api/auth/upload', uploadRouter);
app.use('/api/addresses', addressRouter);
app.use('/api/admin', adminRouter);
app.use('/api/pricing-configs', pricingRouter);

// Base route
app.get('/', (req, res) => {
  res.send('API is running...');
});

export default app;