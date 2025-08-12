import express from 'express';
import bodyParser from 'body-parser';
import { handleWebhook } from '../controllers/webhookController.js';

const router = express.Router();

// Webhook route - needs raw body for signature verification
router.post('/webhook', 
  bodyParser.raw({ type: 'application/json' }), 
  handleWebhook
);

export default router;
