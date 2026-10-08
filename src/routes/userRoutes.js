import express from 'express';
import {
  getUsers,
  createUser,
  updateUser,
  toggleUserStatus,
  approveUser,
  rejectUser,
  deleteUser
} from '../controllers/userController.js';
import { authenticateToken, authorizeRoles } from '../middlewares/authMiddleware.js';

const router = express.Router();

// All routes require authentication + admin/manager/sub_admin role
router.use(authenticateToken);
router.use(authorizeRoles('super_admin', 'sub_admin', 'manager'));

router.get('/', getUsers);
router.post('/', createUser);
router.patch('/:id', updateUser);
router.patch('/:id/toggle', toggleUserStatus);
router.patch('/:id/approve', approveUser);
router.patch('/:id/reject', rejectUser);
router.delete('/:id', deleteUser);

export default router;
