import express from 'express';
import { createCheckoutSession } from '../controllers/checkoutController.js';

const router = express.Router();

// Checkout session route
router.post('/create-checkout-session', createCheckoutSession);

export default router;
