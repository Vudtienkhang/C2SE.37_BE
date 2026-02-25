import express from 'express';
import cors from 'cors';

const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// TODO: Import and use routers here
// import exampleRouter from './routers/exampleRouter.js';
// app.use('/api/example', exampleRouter);

// Base route
app.get('/', (req, res) => {
  res.send('API is running...');
});

export default app;