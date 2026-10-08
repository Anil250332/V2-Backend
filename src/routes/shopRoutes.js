import express from 'express';
import {
  getShops,
  addShop,
  approveShop,
  rejectShop,
  requestDeleteShop,
  approveDeletion
} from '../controllers/shopController.js';
import { authenticateToken, authorizeRoles } from '../middlewares/authMiddleware.js';

const router = express.Router();

// Read & Self-Registration
router.get('/', authenticateToken, getShops);
router.post('/', authenticateToken, addShop);

// Shop Approval & Administrative Management (Admin/Manager Only)
router.patch('/:id/approve', authenticateToken, authorizeRoles('super_admin', 'sub_admin', 'manager'), approveShop);
router.patch('/:id/reject', authenticateToken, authorizeRoles('super_admin', 'sub_admin', 'manager'), rejectShop);
router.post('/:id/request-delete', authenticateToken, requestDeleteShop);
router.patch('/:id/approve-deletion', authenticateToken, authorizeRoles('super_admin', 'sub_admin'), approveDeletion);

export default router;
