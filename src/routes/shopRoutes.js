import express from 'express';
import {
  getShops,
  addShop,
  approveShop,
  rejectShop,
  requestDeleteShop,
  approveDeletion,
  deleteShop
} from '../controllers/shopController.js';
import { authenticateToken, authorizeRoles } from '../middlewares/authMiddleware.js';

const router = express.Router();

// Read & Self-Registration
router.get('/', authenticateToken, authorizeRoles('super_admin', 'sub_admin', 'manager', 'distributor'), getShops);
router.post('/', authenticateToken, authorizeRoles('super_admin', 'sub_admin', 'manager', 'distributor'), addShop);

// Shop Approval & Administrative Management (Admin / Manager only)
router.patch('/:id/approve', authenticateToken, authorizeRoles('super_admin', 'sub_admin', 'manager'), approveShop);
router.patch('/:id/reject', authenticateToken, authorizeRoles('super_admin', 'sub_admin', 'manager'), rejectShop);
router.post('/:id/request-delete', authenticateToken, authorizeRoles('super_admin', 'sub_admin', 'manager', 'distributor'), requestDeleteShop);
router.patch('/:id/approve-deletion', authenticateToken, authorizeRoles('super_admin', 'sub_admin'), approveDeletion);
router.delete('/:id', authenticateToken, authorizeRoles('super_admin', 'sub_admin'), deleteShop);

export default router;
