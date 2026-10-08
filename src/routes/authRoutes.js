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
import nodemailer from 'nodemailer';
import dns from 'dns';
dns.setDefaultResultOrder('ipv4first');

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

// 🔧 Diagnostic: Test SMTP email delivery from Render (remove after debugging)
router.get('/test-email', async (req, res) => {
  const startTime = Date.now();
  const smtpUser = (process.env.SMTP_USER || '').trim();
  const smtpPass = (process.env.SMTP_PASS || '').trim();
  const smtpHost = (process.env.SMTP_HOST || '').trim();
  const emailFrom = (process.env.EMAIL_FROM || '').trim();

  const diagnostics = {
    smtpUser: smtpUser ? smtpUser.substring(0, 8) + '***' : 'NOT SET',
    smtpPass: smtpPass ? '***SET (' + smtpPass.length + ' chars)***' : 'NOT SET',
    smtpHost: smtpHost || 'NOT SET',
    emailFrom: emailFrom || 'NOT SET',
    nodeEnv: process.env.NODE_ENV || 'NOT SET'
  };

  if (!smtpUser || !smtpPass) {
    return res.json({ status: 'error', message: 'SMTP_USER or SMTP_PASS not configured', diagnostics });
  }

  try {
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: { user: smtpUser, pass: smtpPass },
      connectionTimeout: 15000,
      socketTimeout: 15000,
      greetingTimeout: 15000
    });

    // Step 1: Verify connection
    const verified = await transporter.verify();
    const verifyTime = Date.now() - startTime;

    // Step 2: Send test email
    const info = await transporter.sendMail({
      from: `"V2Online Test" <${smtpUser}>`,
      to: smtpUser,
      subject: `[RENDER TEST] SMTP Works - ${new Date().toISOString()}`,
      text: 'This is a diagnostic test email sent from Render server.'
    });

    const totalTime = Date.now() - startTime;

    return res.json({
      status: 'success',
      message: 'Email sent successfully from Render!',
      messageId: info.messageId,
      verifyTimeMs: verifyTime,
      totalTimeMs: totalTime,
      diagnostics
    });
  } catch (error) {
    const totalTime = Date.now() - startTime;
    return res.json({
      status: 'error',
      message: error.message,
      errorCode: error.code || 'UNKNOWN',
      errorCommand: error.command || null,
      totalTimeMs: totalTime,
      diagnostics
    });
  }
});

export default router;
