import dotenv from 'dotenv';
// Load environment variables before importing other modules
dotenv.config();
import Stripe from "stripe";
import express from 'express';
import cors from 'cors';
import connectDB from './config/db.js'
import authRoutes from './routes/auth.js';
import courseRoutes from './routes/courses.js';
import webhookRoutes from './routes/webhook.js';
import checkoutRoutes from './routes/checkout.js';


const app = express();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
app.use(cors());
app.use(express.json());

app.use('/api/auth', authRoutes);
app.use('/api/courses', courseRoutes);
app.use('/api', webhookRoutes);
app.use('/api', checkoutRoutes);

const PORT = process.env.PORT || 5000;
connectDB()
  .then(()=> app.listen(PORT, ()=> console.log(`✅🚀Server running on port ${PORT}`)))
  .catch(err=> { console.error(err); process.exit(1); });

