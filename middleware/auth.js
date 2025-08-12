import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import Purchase from '../models/Purchase.js';
import Course from '../models/Course.js';

export async function auth(req, res, next){
  const header = req.headers.authorization;
  if(!header) return res.status(401).json({ message: 'No token' });
  const token = header.replace(/^Bearer\s+/i, '');
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(payload.sub).select('-passwordHash');
    if(!user) return res.status(401).json({ message: 'Invalid token user' });
    req.user = user;
    next();
  } catch(err) {
    return res.status(401).json({ message: 'Invalid token', error: err.message });
  }
}

export function requireRole(role){
  return (req, res, next) => {
    if(!req.user) return res.status(401).json({ message: 'Not authenticated' });
    if(req.user.role !== role && req.user.role !== 'admin') return res.status(403).json({ message: 'Forbidden' });
    next();
  };
}

// Middleware to check if a user has access to a course
export async function requireCourseAccess(req, res, next) {
  try {
    if (!req.user) return res.status(401).json({ message: 'Not authenticated' });
    
    const courseId = req.params.courseId || req.params.id;
    if (!courseId) return res.status(400).json({ message: 'Course ID is required' });
    
    const course = await Course.findById(courseId);
    if (!course) return res.status(404).json({ message: 'Course not found' });
    
    // If user is admin or course instructor, grant access
    if (
      req.user.role === 'admin' || 
      course.instructor.toString() === req.user._id.toString()
    ) {
      return next();
    }
    
    // Check if user has purchased the course
    const purchase = await Purchase.findOne({
      user: req.user._id,
      course: courseId,
      status: 'paid'
    });
    
    if (!purchase) {
      return res.status(403).json({ 
        message: 'You must purchase this course to access it' 
      });
    }
    
    next();
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
