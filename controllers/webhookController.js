import Stripe from 'stripe';
import dotenv from 'dotenv';
import Purchase from '../models/Purchase.js';
import User from '../models/User.js';
import Course from '../models/Course.js';

dotenv.config();

// Stripe init
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export const handleWebhook = async (req, res) => {
  const sig = req.headers['stripe-signature'];
  console.log('Received webhook event:', req.body);
  // Immediately return a 200 response to acknowledge receipt of the event
  // This is important for Stripe webhooks to prevent retries
  res.status(200).json({ received: true });
  
  // No signature in header
  if (!sig) {
    console.error('Webhook Error: No Stripe signature found in headers');
    return;
  }
  
  // No webhook secret configured
  if (!process.env.STRIPE_WEBHOOK_SECRET) {
    console.error('Webhook Error: STRIPE_WEBHOOK_SECRET not configured');
    return;
  }

  let event;
  try {
    // Verify that the webhook came from Stripe
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    console.error('Webhook signature verification failed.', err.message);
    return;
  }

  try {
    // Handle different event types
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const { customer_email, metadata, customer, amount_total } = session;
        
        if (!metadata || !metadata.courseId) {
          console.error('Webhook Error: Missing courseId in metadata');
          return;
        }
        
        const courseId = metadata.courseId;
        const userId = metadata.userId; // May be undefined for non-logged in users
        const studentEmail = customer_email;

        console.log(`Payment successful for course ${courseId} by ${studentEmail}`);
        
        // Find user by email
        const user = userId 
          ? await User.findById(userId)
          : await User.findOne({ email: studentEmail });
        
        if (!user) {
          console.error(`Could not find user with email ${studentEmail}`);
          return;
        }

        // Check if course exists
        const course = await Course.findById(courseId);
        if (!course) {
          console.error(`Course with ID ${courseId} not found`);
          return;
        }
        
        // Update or create purchase record
        const purchase = await Purchase.findOneAndUpdate(
          { 
            user: user._id, 
            course: courseId,
            status: { $in: ['pending', 'failed'] } // Update if there's a pending or failed purchase
          },
          {
            user: user._id,
            course: courseId,
            amount: amount_total / 100, // Convert from cents
            status: 'paid',
            paymentProvider: 'stripe',
            providerSessionId: session.id,
            paidAt: new Date()
          },
          { upsert: true, new: true } // Create if not found
        );
        
        console.log(`Purchase record created/updated for user ${studentEmail} and course ${courseId}`);
        
        break;
      }
      
      case 'payment_intent.payment_failed': {
        const paymentIntent = event.data.object;
        console.log(`Payment failed: ${paymentIntent.id}`);
        
        // If there's metadata with course and user info, update the purchase record
        if (paymentIntent.metadata && paymentIntent.metadata.courseId && paymentIntent.metadata.userId) {
          await Purchase.findOneAndUpdate(
            { 
              user: paymentIntent.metadata.userId,
              course: paymentIntent.metadata.courseId,
              status: 'pending'
            },
            { status: 'failed' }
          );
          
          console.log(`Updated purchase status to failed for user ${paymentIntent.metadata.userId} and course ${paymentIntent.metadata.courseId}`);
        }
        break;
      }
      
      default:
        // Unexpected event type
        console.log(`Unhandled event type: ${event.type}`);
    }
  } catch (err) {
    console.error(`Error processing webhook: `, err);
  }
};
