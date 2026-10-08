import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import {
  applyService,
  getMyApplications,
  getOperatorQueue,
  getVerificationQueue,
  getApplicationDetails,
  completeApplication,
  verifyApplication,
  rejectApplication
} from '../controllers/applicationController.js';
import { authenticateToken, authorizeRoles } from '../middlewares/authMiddleware.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Ensure uploads/applications directory exists
const appUploadsDir = path.join(__dirname, '../../uploads/applications');
if (!fs.existsSync(appUploadsDir)) {
  fs.mkdirSync(appUploadsDir, { recursive: true });
}

// Configure Multer Storage for Application Documents
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, appUploadsDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const cleanName = path.basename(file.originalname, ext).replace(/[^a-zA-Z0-9]/g, '_');
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e6)}`;
    cb(null, `doc_${cleanName}_${uniqueSuffix}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB per file
});

const router = express.Router();

// 1. Agent Routes
router.post(
  '/apply',
  authenticateToken,
  authorizeRoles('agent'),
  upload.any(),
  applyService
);

router.get(
  '/my-requests',
  authenticateToken,
  authorizeRoles('agent'),
  getMyApplications
);

// 2. Operator Routes
router.get(
  '/operator-queue',
  authenticateToken,
  authorizeRoles('operator', 'super_admin', 'manager'),
  getOperatorQueue
);

router.post(
  '/:id/complete',
  authenticateToken,
  authorizeRoles('operator', 'super_admin', 'manager'),
  upload.any(),
  completeApplication
);

// 3. Admin / Manager Verification Routes
router.get(
  '/verification-queue',
  authenticateToken,
  authorizeRoles('super_admin', 'sub_admin', 'manager'),
  getVerificationQueue
);

router.patch(
  '/:id/verify',
  authenticateToken,
  authorizeRoles('super_admin', 'sub_admin', 'manager'),
  verifyApplication
);

router.patch(
  '/:id/reject',
  authenticateToken,
  authorizeRoles('super_admin', 'sub_admin', 'manager', 'operator'),
  rejectApplication
);

// 4. Single Application Details
router.get(
  '/:id',
  authenticateToken,
  getApplicationDetails
);

export default router;
