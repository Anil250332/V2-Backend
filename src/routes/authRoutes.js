import express from 'express';
import {
  requestRegistrationOtp,
  verifyRegistration,
  login,
  logout,
  getMe,
  changePassword,
  requestForgotPasswordOtp,
  verifyForgotPasswordOtp,
  resetPasswordWithOtp
} from '../controllers/authController.js';
import { authenticateToken } from '../middlewares/authMiddleware.js';

const router = express.Router();

// Public Auth Endpoints
router.post('/register-otp', requestRegistrationOtp);
router.post('/verify-registration', verifyRegistration);
router.post('/login', login);
router.post('/forgot-password-otp', requestForgotPasswordOtp);
router.post('/verify-reset-otp', verifyForgotPasswordOtp);
router.post('/reset-password', resetPasswordWithOtp);

// Protected Auth Endpoints
router.post('/logout', authenticateToken, logout);
router.get('/me', authenticateToken, getMe);
router.post('/change-password', authenticateToken, changePassword);

export default router;
