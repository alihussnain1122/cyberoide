import Stripe from 'stripe';
import dotenv from 'dotenv';
import Course from '../models/Course.js';
import Purchase from '../models/Purchase.js';

dotenv.config();

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export const createCheckoutSession = async (req, res) => {
  const { courseId, courseName, price, studentEmail } = req.body;

  try {
    // Verify the course exists
    const course = await Course.findById(courseId);
    if (!course) {
      return res.status(404).json({ error: 'Course not found' });
    }

    // Check if the user has already purchased this course
    if (req.user) {
      const existingPurchase = await Purchase.findOne({
        user: req.user._id,
        course: courseId,
        status: 'paid'
      });

      if (existingPurchase) {
        return res.status(400).json({ 
          error: 'You have already purchased this course',
          redirect: `/courses/${courseId}`
        });
      }
    }

    // Create a pending purchase record
    if (req.user) {
      const pendingPurchase = await Purchase.findOneAndUpdate(
        { user: req.user._id, course: courseId, status: 'pending' },
        { 
          user: req.user._id,
          course: courseId,
          amount: price,
          currency: 'usd',
          status: 'pending',
          paymentProvider: 'stripe'
        },
        { upsert: true, new: true }
      );
    }

    // Create Stripe checkout session
    const session = await stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      customer_email: studentEmail,
      mode: 'payment',
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: courseName,
              description: course.description?.substring(0, 255) || undefined,
            },
            unit_amount: price * 100, 
          },
          quantity: 1,
        },
      ],
      metadata: {
        courseId,
        userId: req.user?._id?.toString()
      },
      success_url: `${process.env.FRONTEND_URL}/courses/${courseId}?payment=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.FRONTEND_URL}/courses/${courseId}?payment=cancelled`,
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error('Stripe session creation failed:', err);
    res.status(500).json({ error: 'Failed to create checkout session' });
  }
};
