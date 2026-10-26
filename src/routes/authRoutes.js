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

// Diagnostic test endpoint for verifying live email delivery
router.get('/test-email', async (req, res) => {
  const targetEmail = req.query.to || process.env.SMTP_USER;
  try {
    const { getTransporter } = await import('../utils/mailer.js');
    const transporter = getTransporter();
    await transporter.verify();
    const info = await transporter.sendMail({
      from: `"V2Online MP Portal" <${process.env.SMTP_USER}>`,
      to: targetEmail,
      subject: '🧪 [V2Online Test] SMTP Diagnostic Email',
      text: 'This is a test email sent from the live Render backend to verify SMTP configuration.'
    });
    return res.status(200).json({
      status: 'success',
      message: `SMTP is working properly and test email was sent to ${targetEmail}!`,
      messageId: info.messageId,
      accepted: info.accepted
    });
  } catch (err) {
    return res.status(500).json({
      status: 'error',
      message: 'SMTP failed: ' + err.message,
      code: err.code,
      command: err.command
    });
  }
});

// Protected Auth Endpoints
router.post('/logout', authenticateToken, logout);
router.get('/me', authenticateToken, getMe);
router.post('/change-password', authenticateToken, changePassword);

export default router;
