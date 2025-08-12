import mongoose from 'mongoose';

const PurchaseSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  course: { type: mongoose.Schema.Types.ObjectId, ref: 'Course', required: true },
  amount: Number,
  currency: { type: String, default: 'usd' },
  status: { type: String, enum: ['pending','paid','failed'], default: 'pending' },
  paymentProvider: String,
  providerSessionId: String,
  paidAt: Date
}, { timestamps: true });

const Purchase = mongoose.model('Purchase', PurchaseSchema);
export default Purchase;