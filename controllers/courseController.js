import multer from 'multer';
import sanitize from 'sanitize-filename';
import Course from '../models/Course.js';
import File from '../models/File.js';
import Purchase from '../models/Purchase.js';
import {supabase, bucket} from '../config/supabase.js';
import mongoose from 'mongoose';

// Configure multer with file validation and size limits
const fileFilter = (req, file, cb) => {
  // Define allowed file types
  const allowedTypes = [
    'application/pdf',
    'video/mp4',
    'video/webm',
    'image/jpeg',
    'image/png',
    'image/gif',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation', // pptx
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',  // docx
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',        // xlsx
    'application/zip',
    'application/x-zip-compressed',
    'text/plain',
    'text/csv'
  ];
  
  if (allowedTypes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error(`File type not allowed. Allowed types: ${allowedTypes.join(', ')}`), false);
  }
};

// 50MB size limit
const MAX_FILE_SIZE = 50 * 1024 * 1024;

export const upload = multer({
  storage: multer.memoryStorage(),
  fileFilter,
  limits: {
    fileSize: MAX_FILE_SIZE
  }
});

// Flexible middleware to accept either 'file', 'files', or any single file field
// This helps avoid MulterError: Unexpected field when frontend field name differs
export const acceptSingleFile = (req, res, next) => {
  // Use .any() then normalize to req.file
  upload.any()(req, res, (err) => {
    if (err) return next(err);
    if (!req.file && Array.isArray(req.files) && req.files.length) {
      // Prefer a field explicitly named 'file'
      req.file = req.files.find(f => f.fieldname === 'file') || req.files[0];
    }
    next();
  });
};

// Multer error handler to provide clearer client messages
export const multerErrorHandler = (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    let message = err.message;
    if (err.code === 'LIMIT_FILE_SIZE') {
      message = `File too large. Max size is ${MAX_FILE_SIZE / (1024 * 1024)}MB`;
    } else if (err.code === 'LIMIT_UNEXPECTED_FILE') {
      message = 'Unexpected file field. Use a single file input.';
    }
    return res.status(400).json({ error: message });
  }
  next(err);
};

// Create course (instructor)
export const createCourse = async (req, res) => {
  try {
    const { title, description, priceCents } = req.body;
    const course = await Course.create({ title, description, priceCents, instructor: req.user._id });
    res.json(course);
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
};

// Update course (instructor only)
export const updateCourse = async (req, res) => {
  try {
    const { title, description, priceCents } = req.body;
    const course = await Course.findById(req.params.id);
    
    if (!course) {
      return res.status(404).json({ message: 'Course not found' });
    }
    
    // Check if user is the course instructor or admin
    if (course.instructor.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Not authorized to update this course' });
    }
    
    // Update course fields
    if (title) course.title = title;
    if (description !== undefined) course.description = description;
    if (priceCents !== undefined) course.priceCents = priceCents;
    
    await course.save();
    
    res.json(course);
  } catch(err) {
    res.status(500).json({ error: err.message });
  }
};

// Upload file (instructor only) — uploads to Supabase and creates File doc
export const uploadFile = async (req, res) => {
  try {
    if (supabase.__notConfigured) {
      return res.status(500).json({
        error: 'Supabase not configured',
        help: 'Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in backend/.env and restart server.'
      });
    }
    const course = await Course.findById(req.params.id);
    if(!course) return res.status(404).json({ message: 'Course not found' });
    if(course.instructor.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Not authorized to upload files for this course' });
    }

    const file = req.file;
    if(!file) return res.status(400).json({ message: 'No file uploaded' });
    
    // Additional validation
    if (file.size > MAX_FILE_SIZE) {
      return res.status(413).json({ 
        message: `File size exceeds limit of ${MAX_FILE_SIZE / (1024 * 1024)}MB` 
      });
    }

    // Generate a sanitized filename and unique path
    const safeName = sanitize(file.originalname.replace(/\s+/g,'_'));
    const path = `${course._id}/${Date.now()}_${safeName}`;

    // Upload to Supabase storage
    const { data, error: uploadError } = await supabase
      .storage
      .from(bucket)
      .upload(path, file.buffer, { 
        contentType: file.mimetype, 
        upsert: false,
        // Set cacheControl to prevent browser caching and enforce validation
        cacheControl: 'no-cache, private'
      });

    if(uploadError) {
      console.error('Supabase upload error:', uploadError);
      throw new Error('File upload failed: ' + (uploadError.message || 'Unknown error'));
    }

    // Create File document in MongoDB
    const fileDoc = await File.create({
      path,
      filename: file.originalname,
      mimeType: file.mimetype,
      size: file.size,
      course: course._id,
      instructor: req.user._id
    });

    // Add file reference to course
    course.materials.push(fileDoc._id);
    await course.save();

    res.json({ 
      message: 'File uploaded successfully', 
      file: fileDoc 
    });
  } catch(err) {
    console.error('File upload error:', err);
    res.status(500).json({ error: err.message || 'File upload failed' });
  }
};

// Delete file (instructor only)
export const deleteFile = async (req, res) => {
  try {
    const { courseId, fileId } = req.params;
    
    // Find the file
    const file = await File.findById(fileId);
    if (!file) {
      return res.status(404).json({ message: 'File not found' });
    }
    
    // Check permissions
    if (file.instructor.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Not authorized to delete this file' });
    }
    
    // Check if file belongs to the specified course
    if (file.course.toString() !== courseId) {
      return res.status(400).json({ message: 'File does not belong to the specified course' });
    }
    
    // Delete from Supabase storage
    const { error: deleteError } = await supabase
      .storage
      .from(bucket)
      .remove([file.path]);
      
    if (deleteError) {
      console.error('Error deleting from storage:', deleteError);
      // Continue anyway to clean up the database
    }
    
    // Remove file reference from course
    await Course.findByIdAndUpdate(courseId, {
      $pull: { materials: fileId }
    });
    
    // Delete file document
    await File.findByIdAndDelete(fileId);
    
    res.json({ message: 'File deleted successfully' });
  } catch (err) {
    console.error('File deletion error:', err);
    res.status(500).json({ error: err.message || 'Failed to delete file' });
  }
};

// Get signed URL for file (student must have paid)
export const getSignedFileUrl = async (req, res) => {
  try {
    const { courseId, fileId } = req.params;
    const file = await File.findById(fileId);
    if(!file) return res.status(404).json({ message: 'File not found' });
    if(file.course.toString() !== courseId) return res.status(400).json({ message: 'File does not belong to this course' });

    // Access control is handled by the requireCourseAccess middleware

    // Generate a signed URL with a short expiration time (15 minutes)
    // This reduces the window of opportunity for URL sharing
    const { data, error } = await supabase
      .storage
      .from(bucket)
      .createSignedUrl(file.path, 15 * 60);

    if(error) {
      console.error('Signed URL generation error:', error);
      throw new Error('Failed to generate file access URL');
    }
    
    // Track file access for analytics (optional)
    console.log(`File access: ${req.user.email} accessed ${file.filename} from course ${courseId}`);
    
    res.json({ 
      url: data.signedUrl,
      expiresAt: new Date(Date.now() + (15 * 60 * 1000)), // 15 minutes from now
      filename: file.filename,
      mimeType: file.mimeType
    });
  } catch(err) {
    console.error('File access error:', err);
    res.status(500).json({ error: err.message || 'Failed to generate file access URL' });
  }
};

// Get all courses with access flag
export const getAllCourses = async (req, res) => {
  try {
    const courses = await Course.find().populate('instructor', 'name email');
    
    // If user is authenticated, check their purchased courses
    let purchasedCourseIds = [];
    if (req.user) {
      const purchases = await Purchase.find({ 
        user: req.user._id, 
        status: 'paid' 
      });
      purchasedCourseIds = purchases.map(p => p.course.toString());
    }

    const coursesWithAccess = courses.map(course => {
      const courseObj = course.toObject();
      // User has access if they're admin, the instructor, or have purchased the course
      courseObj.hasAccess = req.user?.role === 'admin' || 
                           (course.instructor._id.toString() === req.user?._id.toString()) || 
                           purchasedCourseIds.includes(course._id.toString());
      
      // Include material count but not the actual materials for non-purchased courses                     
      courseObj.materialCount = course.materials ? course.materials.length : 0;
      
      return courseObj;
    });

    res.json(coursesWithAccess);
  } catch (err) {
    console.error('Error fetching courses:', err);
    res.status(500).json({ error: err.message });
  }
};

// Get course details if purchased or owned
export const getCourseById = async (req, res) => {
  try {
    const course = await Course.findById(req.params.id)
      .populate('instructor', 'name email')
      .populate('materials');
    
    if (!course) {
      return res.status(404).json({ message: 'Course not found' });
    }

    // Check if user has access to this course
    const isInstructor = course.instructor._id.toString() === req.user._id.toString();
    const isAdmin = req.user.role === 'admin';
    
    if (isInstructor || isAdmin) {
      return res.json({ ...course.toObject(), hasAccess: true });
    }

    // Check if the user has purchased the course
    const purchase = await Purchase.findOne({ 
      user: req.user._id, 
      course: course._id,
      status: 'paid'
    });

    if (!purchase) {
      // Return limited course info for non-purchasers
      return res.status(403).json({ 
        message: 'You must purchase this course to access it',
        course: {
          _id: course._id,
          title: course.title,
          description: course.description,
          priceCents: course.priceCents,
          instructor: course.instructor,
          materialCount: course.materials ? course.materials.length : 0,
          hasAccess: false
        }
      });
    }

    res.json({ ...course.toObject(), hasAccess: true });
  } catch (err) {
    console.error('Error fetching course details:', err);
    res.status(500).json({ error: err.message });
  }
};

// Get course sales statistics (instructor only)
export const getCourseSalesStats = async (req, res) => {
  try {
    const courseId = req.params.id;
    
    // First check if this course belongs to the instructor
    const course = await Course.findById(courseId);
    if (!course) {
      return res.status(404).json({ message: 'Course not found' });
    }
    
    // Only allow the instructor of the course or an admin to see stats
    if (course.instructor.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
      return res.status(403).json({ message: 'Not authorized to view sales stats for this course' });
    }
    
    // Get all purchases for this course
    const purchases = await Purchase.find({ 
      course: courseId,
      status: 'paid'
    }).populate('user', 'name email');
    
    // Calculate stats
    const totalSales = purchases.length;
    const totalRevenue = purchases.reduce((sum, purchase) => sum + (purchase.amount || 0), 0);
    
    // Get recent purchases (last 5)
    const recentPurchases = purchases
      .sort((a, b) => new Date(b.paidAt) - new Date(a.paidAt))
      .slice(0, 5)
      .map(p => ({
        id: p._id,
        studentName: p.user.name,
        studentEmail: p.user.email,
        amount: p.amount,
        date: p.paidAt
      }));
    
    // Return stats
    res.json({
      courseId,
      courseTitle: course.title,
      totalSales,
      totalRevenue,
      recentPurchases
    });
  } catch (err) {
    console.error('Error fetching sales stats:', err);
    res.status(500).json({ error: err.message });
  }
};

// List files for a course (students must have access). Returns basic metadata only.
export const listCourseFiles = async (req, res) => {
  try {
    const courseId = req.params.courseId || req.params.id;
    if (!courseId || !mongoose.Types.ObjectId.isValid(courseId)) {
      return res.status(400).json({ message: 'Invalid course ID' });
    }
    // Ensure course exists
    const course = await Course.findById(courseId).populate('instructor', 'name email');
    if (!course) return res.status(404).json({ message: 'Course not found' });

    // Access: admin, instructor, or purchaser
    let hasAccess = false;
    if (req.user) {
      hasAccess = req.user.role === 'admin' || course.instructor._id.toString() === req.user._id.toString();
      if (!hasAccess) {
        const purchase = await Purchase.findOne({ user: req.user._id, course: courseId, status: 'paid' });
        hasAccess = !!purchase;
      }
    }
    if (!hasAccess) {
      return res.status(403).json({ message: 'You must purchase this course to view files' });
    }

    const files = await File.find({ course: courseId }).sort({ uploadedAt: -1 }).select('-__v -instructor');
    res.json({ course: { _id: course._id, title: course.title }, files });
  } catch (err) {
    console.error('List course files error:', err);
    res.status(500).json({ error: err.message });
  }
};
