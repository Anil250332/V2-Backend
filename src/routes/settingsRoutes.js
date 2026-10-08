import express from 'express';
import { getSettings, updateSettings } from '../controllers/settingsController.js';
import { authenticateToken, authorizeRoles } from '../middlewares/authMiddleware.js';

const router = express.Router();

// GET /api/settings (Public / Authorized)
router.get('/', getSettings);

// PUT /api/settings (Admin / Manager)
router.put('/', authenticateToken, authorizeRoles('super_admin', 'sub_admin', 'manager'), updateSettings);

export default router;

