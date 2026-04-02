import express from 'express';
import cors from 'cors';

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request Logger
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// Routers
import authRouter from './routers/auth.router.js';
import chatRouter from './routers/chat.router.js';
import uploadRouter from './routers/upload.router.js';
import addressRouter from './routers/address.router.js';
import adminRouter from './routers/admin.router.js';
import documentTypeRouter from './routers/document-type.router.js';
import pricingRouter from './routers/pricingConfig.router.js';
import holidayRouter from './routers/holiday.router.js';
import driverScanRouter from './routers/driver-scan.router.js';

import voucherRouter from './routers/voucher.router.js';
import driverRouter from './routers/driver.router.js';


import tripRouter from './routers/trip.router.js';
import customerRouter from './routers/customer.router.js';
import notificationRouter from './routers/notification.router.js';
import paymentRouter from './routers/payment.router.js';
import reviewRouter from './routers/review.router.js';
import disputeRouter from './routers/dispute.router.js';
import sosRouter from './routers/sos.router.js';


app.use('/api/auth', authRouter);
app.use('/api/chat', chatRouter);
app.use('/api/auth/upload', uploadRouter);
app.use('/api/addresses', addressRouter);
app.use('/api/admin', adminRouter);
app.use('/api/document-types', documentTypeRouter);
app.use('/api/pricing-configs', pricingRouter);
app.use('/api/holidays', holidayRouter);
app.use('/api/driver-scan', driverScanRouter);

app.use('/api/vouchers', voucherRouter);
app.use('/api/trips', tripRouter);
app.use('/api/customers', customerRouter);
app.use('/api/notifications', notificationRouter);
app.use('/api/v1/payment', paymentRouter);
app.use('/api/reviews', reviewRouter);
app.use('/api/drivers', driverRouter);
app.use('/api/disputes', disputeRouter);
app.use('/api/sos', sosRouter);



// Base route
app.get('/', (req, res) => {
  res.send('API is running...');
});

export default app;