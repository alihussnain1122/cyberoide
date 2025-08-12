import mongoose from 'mongoose';

const CourseSchema = new mongoose.Schema({
  title: { type: String, required: true },
  description: String,
  priceCents: { type: Number, default: 0 },
  instructor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  materials: [{ type: mongoose.Schema.Types.ObjectId, ref: 'File' }]
}, { timestamps: true });

const Course = mongoose.model('Course', CourseSchema);
export default Course;
