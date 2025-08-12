import Stripe from 'stripe';
import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import Purchase from '../models/Purchase.js';
import User from '../models/User.js';

dotenv.config();

// Stripe & Supabase init
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

export const handleWebhook = async (req, res) => {
  const sig = req.headers['stripe-signature'];
  
  // Immediately return a 200 response to acknowledge receipt of the event
  // This is important for Stripe webhooks to prevent retries
  res.status(200).json({ received: true });
  
  // No signature in header
  if (!sig) {
    console.error(' Webhook Error: No Stripe signature found in headers');
    return;
  }
  
  // No webhook secret configured
  if (!process.env.STRIPE_WEBHOOK_SECRET) {
    console.error(' Webhook Error: STRIPE_WEBHOOK_SECRET not configured');
    return;
  }

  let event;
  try {
    // Verify that the webhook came from Stripe
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error(' Webhook signature verification failed.', err.message);
    return;
  }

  try {
    // Handle different event types
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const { customer_email, metadata, customer, amount_total } = session;
        
        if (!metadata || !metadata.courseId) {
          console.error(' Webhook Error: Missing courseId in metadata');
          return;
        }
        
        const courseId = metadata.courseId;
        const studentEmail = customer_email;
        
        console.log( Payment successful for course  by );
        
        // Grant access in Supabase
        const { error } = await supabase
          .from('course_access')
          .insert([{ course_id: courseId, student_email: studentEmail }]);

        if (error) {
          console.error(' Supabase error granting access:', error);
        } else {
          console.log( Access granted in Supabase to  for course );
        }
        
        // Also record the purchase in our database
        // Find user by email
        const user = await User.findOne({ email: studentEmail });
        
        if (user) {
          await Purchase.create({
            user: user._id,
            course: courseId,
            amount: amount_total / 100, // Convert from cents
            status: 'paid',
            paymentProvider: 'stripe',
            providerSessionId: session.id,
            paidAt: new Date()
          });
          
          console.log( Purchase record created for user  and course );
        } else {
          console.error( Could not find user with email );
        }
        
        break;
      }
      
      case 'payment_intent.payment_failed': {
        const paymentIntent = event.data.object;
        console.log( Payment failed: , );
        break;
      }
      
      default:
        // Unexpected event type
        console.log( Unhandled event type: );
    }
  } catch (err) {
    console.error( Error processing webhook: , err);
  }
};
