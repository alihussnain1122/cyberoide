import express from 'express';
import {auth, requireRole, requireCourseAccess} from '../middleware/auth.js';
import {
  upload,
  acceptSingleFile,
  multerErrorHandler,
  createCourse,
  updateCourse,
  uploadFile,
  deleteFile,
  getSignedFileUrl,
  getAllCourses,
  getCourseById,
  getCourseSalesStats,
  listCourseFiles
} from '../controllers/courseController.js';

const router = express.Router();

// Public route to get all courses (access flag will be added if authenticated)
router.get('/', getAllCourses);

// Protected routes - Instructor Only
router.post('/', auth, requireRole('instructor'), createCourse);
router.put('/:id', auth, requireRole('instructor'), updateCourse);
router.post('/:id/upload', auth, requireRole('instructor'), acceptSingleFile, uploadFile, multerErrorHandler);
router.delete('/:courseId/files/:fileId', auth, requireRole('instructor'), deleteFile);
router.get('/:id/sales', auth, requireRole('instructor'), getCourseSalesStats);

// Get course details by ID (with access control)
router.get('/:id', auth, getCourseById);

// File access - requires payment verification
router.get('/:courseId/files/:fileId/signed-url', auth, requireCourseAccess, getSignedFileUrl);

// List all files in a course (must have course access)
router.get('/:courseId/files', auth, requireCourseAccess, listCourseFiles);

export default router;
