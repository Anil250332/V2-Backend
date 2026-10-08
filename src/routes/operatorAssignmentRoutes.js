import express from 'express';
import {
  getAssignments,
  createAssignment,
  deleteAssignment,
  getAvailableAreas,
  findOperator
} from '../controllers/operatorAssignmentController.js';
import { authenticateToken, authorizeRoles } from '../middlewares/authMiddleware.js';

const router = express.Router();

// Smart Agent Dropdown & Operator Matching (Authenticated Users)
router.get('/areas', authenticateToken, getAvailableAreas);
router.get('/find-operator', authenticateToken, findOperator);

// Operator Assignment CRUD (Protected: Admin, Manager & Operator)
router.get('/', authenticateToken, authorizeRoles('super_admin', 'sub_admin', 'manager', 'operator'), getAssignments);
router.post('/', authenticateToken, authorizeRoles('super_admin', 'sub_admin', 'manager'), createAssignment);
router.delete('/:id', authenticateToken, authorizeRoles('super_admin', 'sub_admin', 'manager'), deleteAssignment);

export default router;
