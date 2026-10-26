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

// Diagnostic test endpoint for verifying live email delivery via Resend API
router.get('/test-email', async (req, res) => {
  const targetEmail = req.query.to || process.env.ADMIN_EMAIL || 'raj008chaurasia@gmail.com';
  try {
    const { sendEmail } = await import('../utils/mailer.js');
    const result = await sendEmail({
      to: targetEmail,
      subject: '🧪 [V2Online Test] Resend API Diagnostic Email',
      text: 'This is a test email sent from the live Render backend using Resend HTTPS API (Port 443) to verify email delivery.',
      html: '<p>This is a test email sent from the live Render backend using <strong>Resend HTTPS API (Port 443)</strong> to verify email delivery.</p>'
    });

    if (result.success) {
      return res.status(200).json({
        status: 'success',
        message: `Resend API test email sent successfully to ${targetEmail}!`,
        messageId: result.messageId
      });
    } else {
      return res.status(500).json({
        status: 'error',
        message: 'Resend email delivery failed: ' + result.error,
        details: result
      });
    }
  } catch (err) {
    return res.status(500).json({
      status: 'error',
      message: 'Email test exception: ' + err.message
    });
  }
});

// Protected Auth Endpoints
router.post('/logout', authenticateToken, logout);
router.get('/me', authenticateToken, getMe);
router.post('/change-password', authenticateToken, changePassword);

export default router;
