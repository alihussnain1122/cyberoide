import mongoose from 'mongoose';

const FileSchema = new mongoose.Schema({
  path: { type: String, required: true, unique: true }, // path in supabase bucket: courseId/filename
  filename: String,
  mimeType: String,
  size: Number,
  course: { type: mongoose.Schema.Types.ObjectId, ref: 'Course', required: true },
  instructor: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  uploadedAt: { type: Date, default: Date.now }
});

const File = mongoose.model('File', FileSchema);
export default File;
