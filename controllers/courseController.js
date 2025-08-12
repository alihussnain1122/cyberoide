import multer from 'multer';
import sanitize from 'sanitize-filename';
import Course from '../models/Course.js';
import File from '../models/File.js';
import Purchase from '../models/Purchase.js';
import {supabase, bucket} from '../config/supabase.js';

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
    const course = await Course.findById(req.params.id);
    if(!course) return res.status(404).json({ message: 'Course not found' });
    if(course.instructor.toString() !== req.user._id.toString()) return res.status(403).json({ message: 'Not owner' });

    const file = req.file;
    if(!file) return res.status(400).json({ message: 'No file uploaded' });
    
    // Additional validation
    if (file.size > MAX_FILE_SIZE) {
      return res.status(413).json({ 
        message: `File size exceeds limit of ${MAX_FILE_SIZE / (1024 * 1024)}MB` 
      });
    }

    const safeName = sanitize(file.originalname.replace(/\s+/g,'_'));
    const path = `${course._id}/${Date.now()}_${safeName}`;

    const { error: uploadError } = await supabase
      .storage
      .from(bucket)
      .upload(path, file.buffer, { contentType: file.mimetype, upsert: false });

    if(uploadError) throw uploadError;

    const fileDoc = await File.create({
      path,
      filename: file.originalname,
      mimeType: file.mimetype,
      size: file.size,
      course: course._id,
      instructor: req.user._id
    });

    course.materials.push(fileDoc._id);
    await course.save();

    res.json({ message: 'Uploaded', file: fileDoc });
  } catch(err) {
    res.status(500).json({ error: err.message || err });
  }
};

// Get signed URL for file (student must have paid)
export const getSignedFileUrl = async (req, res) => {
  try {
    const { courseId, fileId } = req.params;
    const file = await File.findById(fileId);
    if(!file) return res.status(404).json({ message: 'File not found' });
    if(file.course.toString() !== courseId) return res.status(400).json({ message: 'Course/file mismatch' });

    // Access control is now handled by the requireCourseAccess middleware

    // Generate a signed URL with a shorter expiration time (15 minutes)
    // This reduces the window of opportunity for URL sharing
    const { data, error } = await supabase
      .storage
      .from(bucket)
      .createSignedUrl(file.path, 15 * 60);

    if(error) throw error;
    
    // Track file access for analytics (optional)
    console.log(`File access: ${req.user.email} accessed ${file.filename} from course ${courseId}`);
    
    res.json({ 
      url: data.signedUrl,
      expiresAt: new Date(Date.now() + (15 * 60 * 1000)), // 15 minutes from now
      filename: file.filename
    });
  } catch(err) {
    res.status(500).json({ error: err.message || err });
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
      courseObj.hasAccess = req.user?.role === 'admin' || 
                           (course.instructor._id.toString() === req.user?._id.toString()) || 
                           purchasedCourseIds.includes(course._id.toString());
      return courseObj;
    });

    res.json(coursesWithAccess);
  } catch (err) {
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
      return res.status(403).json({ 
        message: 'You must purchase this course to access it',
        course: {
          _id: course._id,
          title: course.title,
          description: course.description,
          priceCents: course.priceCents,
          instructor: course.instructor,
          hasAccess: false
        }
      });
    }

    res.json({ ...course.toObject(), hasAccess: true });
  } catch (err) {
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
    res.status(500).json({ error: err.message });
  }
};
