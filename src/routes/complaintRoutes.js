import express from 'express';
import { getComplaints, createComplaint, updateComplaintStatus } from '../controllers/complaintController.js';
import { authenticateToken, authorizeRoles } from '../middlewares/authMiddleware.js';

const router = express.Router();

router.get('/', authenticateToken, getComplaints);
router.post('/', authenticateToken, createComplaint);
router.patch('/:id/status', authenticateToken, authorizeRoles('super_admin', 'sub_admin', 'manager'), updateComplaintStatus);

export default router;
