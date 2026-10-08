import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import pool from '../config/db.js';
import { generateToken } from '../utils/jwt.js';
import { sendOtpEmail, sendAdminRegistrationAlert, sendPasswordChangedEmail, sendPasswordResetOtpEmail } from '../utils/mailer.js';

// In-memory temporary store for Registration OTPs (Mobile -> { otp, data, expiresAt })
const otpStore = new Map();

// In-memory temporary store for Password Reset OTPs (Email -> { otp, userId, userName, expiresAt })
const passwordResetOtpStore = new Map();

/**
 * 1. Step 1: Request OTP for Self-Registration (Agent or Operator)
 * POST /api/auth/register-otp
 */
export const requestRegistrationOtp = async (req, res) => {
  try {
    const { 
      full_name, mobile, role = 'agent', shop_name, office_name, 
      aadhaar_number, district, tehsil, ward_no, address, designation, area, email 
    } = req.body;

    if (!mobile || !full_name) {
      return res.status(400).json({
        status: 'error',
        message: 'Full name and Mobile number are required.'
      });
    }

    if (!['agent', 'operator'].includes(role)) {
      return res.status(400).json({
        status: 'error',
        message: 'Self-registration is only allowed for Agent and Operator roles.'
      });
    }

    // Check if mobile already exists in DB
    const [existingUsers] = await pool.query('SELECT id FROM users WHERE mobile = ?', [mobile]);
    if (existingUsers.length > 0) {
      return res.status(400).json({
        status: 'error',
        message: 'Ye mobile number pehle se registered hai. Kripya login karein ya doosra number use karein.'
      });
    }

    // Generate secure 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = Date.now() + 5 * 60 * 1000; // 5 minutes validity

    // Store in memory
    otpStore.set(mobile, {
      otp,
      expiresAt,
      userData: {
        full_name,
        mobile,
        role,
        email: email || null,
        shop_name: role === 'agent' ? shop_name : (office_name || shop_name || null),
        aadhaar_number: aadhaar_number || null,
        district: area || district || null,
        tehsil: designation || tehsil || null,
        ward_no: ward_no || null,
        address: address || null
      }
    });

    // Dispatch OTP via Email Notification module asynchronously (non-blocking)
    if (email) {
      sendOtpEmail(email, otp, full_name)
        .then(sent => console.log(`📧 [Auth] OTP email dispatch to ${email} status: ${sent}`))
        .catch(err => console.error('❌ [Auth] Email OTP dispatch error:', err.message));
    }

    return res.status(200).json({
      status: 'success',
      message: `OTP sent successfully${email ? ' to email ' + email : ''}.`
    });
  } catch (error) {
    console.error('Request OTP Error:', error);
    return res.status(500).json({
      status: 'error',
      message: 'OTP send karne me error aaya. Kripya dobara try karein.'
    });
  }
};

/**
 * 2. Step 2: Verify OTP & Complete Self-Registration
 * POST /api/auth/verify-registration
 */
export const verifyRegistration = async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const { mobile, otp, password } = req.body;

    if (!mobile || !otp || !password) {
      return res.status(400).json({
        status: 'error',
        message: 'Mobile number, OTP, and Password are required.'
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        status: 'error',
        message: 'Password kam se kam 6 characters ka hona chahiye.'
      });
    }

    const storedOtpEntry = otpStore.get(mobile);
    if (!storedOtpEntry) {
      return res.status(400).json({
        status: 'error',
        message: 'OTP session expire ho chuka hai. Kripya naya OTP request karein.'
      });
    }

    if (Date.now() > storedOtpEntry.expiresAt) {
      otpStore.delete(mobile);
      return res.status(400).json({
        status: 'error',
        message: 'OTP expire ho gaya hai. Kripya naya OTP generate karein.'
      });
    }

    if (storedOtpEntry.otp !== otp.trim()) {
      return res.status(400).json({
        status: 'error',
        message: 'Galat OTP enter kiya gaya hai. Kripya sahi OTP daalein.'
      });
    }

    // OTP is valid! Proceed with user creation in DB
    const { userData } = storedOtpEntry;
    const userUuid = crypto.randomUUID();
    const passwordHash = await bcrypt.hash(password, 10);

    await connection.beginTransaction();

    const [userResult] = await connection.query(
      `INSERT INTO users (
        uuid, role, full_name, mobile, email, password_hash, shop_name, aadhaar_number, 
        district, tehsil, ward_no, address, approval_status, is_active
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', true)`,
      [
        userUuid,
        userData.role,
        userData.full_name,
        userData.mobile,
        userData.email || null,
        passwordHash,
        userData.shop_name,
        userData.aadhaar_number,
        userData.district,
        userData.tehsil,
        userData.ward_no,
        userData.address
      ]
    );

    const newUserId = userResult.insertId;

    // If agent, create corresponding record in dedicated shops table
    if (userData.role === 'agent') {
      const year = new Date().getFullYear();
      const shopCode = `SHOP-${year}-${1000 + newUserId}`;
      await connection.query(
        `INSERT INTO shops (
          shop_id_code, user_id, owner_name, shop_name, mobile, email,
          aadhaar_number, full_address, district, tehsil, ward_no, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
        [
          shopCode,
          newUserId,
          userData.full_name,
          userData.shop_name || `${userData.full_name} Kiosk`,
          userData.mobile,
          userData.email || null,
          userData.aadhaar_number || null,
          userData.address || null,
          userData.district || null,
          userData.tehsil || null,
          userData.ward_no || null
        ]
      );
    }

    // Create wallet for the newly registered user
    await connection.query('INSERT INTO wallets (user_id, balance) VALUES (?, 0.00)', [newUserId]);

    await connection.commit();

    // Clean up OTP from memory
    otpStore.delete(mobile);

    // Notify Admin about new registration (non-blocking)
    sendAdminRegistrationAlert({
      name: userData.full_name,
      mobile: userData.mobile,
      email: userData.email,
      role: userData.role,
      shopName: userData.shop_name
    }).catch(err => console.error('Admin reg alert email error:', err.message));

    return res.status(201).json({
      status: 'success',
      message: 'Registration safal raha! Aapka account verification ke liye pending hai. Admin / Manager approval ke baad aap login kar sakenge.',
      data: {
        userId: newUserId,
        role: userData.role,
        approval_status: 'pending'
      }
    });
  } catch (error) {
    await connection.rollback();
    console.error('Verify Registration Error:', error);
    return res.status(500).json({
      status: 'error',
      message: 'Account creation me error aaya: ' + error.message
    });
  } finally {
    connection.release();
  }
};

/**
 * 3. Login Endpoint (Multi-Role Support)
 * POST /api/auth/login
 */
export const login = async (req, res) => {
  try {
    const { mobile, password } = req.body;

    if (!mobile || !password) {
      return res.status(400).json({
        status: 'error',
        message: 'Mobile number aur Password dono zaroori hain.'
      });
    }

    const [users] = await pool.query('SELECT * FROM users WHERE mobile = ?', [mobile.trim()]);
    if (users.length === 0) {
      return res.status(401).json({
        status: 'error',
        message: 'Ye mobile number registered nahi hai.'
      });
    }

    const user = users[0];

    // Check Password
    const isPasswordValid = await bcrypt.compare(password, user.password_hash);
    if (!isPasswordValid) {
      return res.status(401).json({
        status: 'error',
        message: 'Galat Password enter kiya gaya hai.'
      });
    }

    // Check Active Status
    if (!user.is_active) {
      return res.status(403).json({
        status: 'error',
        message: 'Aapka account suspended / blocked hai. Kripya Admin se sampark karein.'
      });
    }

    // Check Approval Status
    if (user.approval_status === 'pending') {
      return res.status(403).json({
        status: 'error',
        approval_status: 'pending',
        message: 'Aapka account abhi verification ke liye pending hai. Admin approval ke baad activate hoga.'
      });
    }

    if (user.approval_status === 'rejected') {
      return res.status(403).json({
        status: 'error',
        approval_status: 'rejected',
        message: 'Aapka registration request reject kar diya gaya hai. Kripya support se sampark karein.'
      });
    }

    // Update Online Status & Last Login
    await pool.query('UPDATE users SET is_online = true, last_login_at = NOW() WHERE id = ?', [user.id]);

    // Fetch User Wallet Balance
    const [wallets] = await pool.query('SELECT balance FROM wallets WHERE user_id = ?', [user.id]);
    const walletBalance = wallets.length > 0 ? parseFloat(wallets[0].balance) : 0.00;

    // Generate 24h JWT Token
    const token = generateToken(user);

    // Multi-role redirect URL mapping
    const redirectMap = {
      super_admin: '/admin/dashboard',
      sub_admin: '/admin/dashboard',
      manager: '/manager/dashboard',
      distributor: '/distributor/dashboard',
      operator: '/operator/dashboard',
      agent: '/agent/dashboard'
    };

    return res.status(200).json({
      status: 'success',
      message: `Swagat hai, ${user.full_name}!`,
      token,
      redirect_url: redirectMap[user.role] || '/agent/dashboard',
      user: {
        id: user.id,
        uuid: user.uuid,
        role: user.role,
        full_name: user.full_name,
        mobile: user.mobile,
        email: user.email,
        shop_name: user.shop_name,
        district: user.district,
        tehsil: user.tehsil,
        ward_no: user.ward_no,
        wallet_balance: walletBalance
      }
    });
  } catch (error) {
    console.error('Login Error:', error);
    return res.status(500).json({
      status: 'error',
      message: 'Login me error aaya: ' + error.message
    });
  }
};

/**
 * 4. Logout Endpoint (Sets is_online = false)
 * POST /api/auth/logout
 */
export const logout = async (req, res) => {
  try {
    if (req.user?.id) {
      await pool.query('UPDATE users SET is_online = false WHERE id = ?', [req.user.id]);
    }
    return res.status(200).json({
      status: 'success',
      message: 'Logged out successfully.'
    });
  } catch (error) {
    console.error('Logout Error:', error);
    return res.status(500).json({
      status: 'error',
      message: 'Logout failed.'
    });
  }
};

/**
 * 5. Get Current User Profile & Balance
 * GET /api/auth/me
 */
export const getMe = async (req, res) => {
  try {
    const userId = req.user.id;
    const [wallets] = await pool.query('SELECT balance FROM wallets WHERE user_id = ?', [userId]);
    const walletBalance = wallets.length > 0 ? parseFloat(wallets[0].balance) : 0.00;

    return res.status(200).json({
      status: 'success',
      user: {
        ...req.user,
        wallet_balance: walletBalance
      }
    });
  } catch (error) {
    console.error('Get Me Error:', error);
    return res.status(500).json({
      status: 'error',
      message: 'Failed to fetch user profile.'
    });
  }
};

/**
 * 6. Change Password Endpoint
 * POST /api/auth/change-password
 */
export const changePassword = async (req, res) => {
  try {
    const userId = req.user?.id;
    const { currentPassword, newPassword } = req.body;

    if (!userId) {
      return res.status(401).json({ status: 'error', message: 'Unauthorized session. Please login again.' });
    }

    if (!currentPassword || !newPassword) {
      return res.status(400).json({ status: 'error', message: 'Current password and new password are required.' });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ status: 'error', message: 'New password must be at least 6 characters long.' });
    }

    const [users] = await pool.query('SELECT id, password_hash FROM users WHERE id = ?', [userId]);
    if (users.length === 0) {
      return res.status(404).json({ status: 'error', message: 'User account not found.' });
    }

    const user = users[0];
    const isMatch = await bcrypt.compare(currentPassword, user.password_hash);
    if (!isMatch) {
      return res.status(400).json({ status: 'error', message: 'Galat Current Password enter kiya gaya hai.' });
    }

    const newHash = await bcrypt.hash(newPassword, 10);
    await pool.query('UPDATE users SET password_hash = ? WHERE id = ?', [newHash, userId]);

    // Send security notification email
    if (req.user?.email) {
      sendPasswordChangedEmail({
        toEmail: req.user.email,
        userName: req.user.full_name
      }).catch(err => console.error('Password change email error:', err.message));
    }

    return res.status(200).json({ status: 'success', message: 'Password successfully updated!' });
  } catch (error) {
    console.error('Change Password Error:', error);
    return res.status(500).json({ status: 'error', message: error.message });
  }
};

/**
 * 7. Request Password Reset OTP via Email (15 Min Expiry)
 * POST /api/auth/forgot-password-otp
 */
export const requestForgotPasswordOtp = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email || !email.trim()) {
      return res.status(400).json({
        status: 'error',
        message: 'Email address zaroori hai. Kripya apna registered email enter karein.'
      });
    }

    const cleanEmail = email.trim().toLowerCase();

    // Check if user exists with this email address
    const [users] = await pool.query(
      'SELECT id, full_name, email FROM users WHERE LOWER(email) = ? AND is_active = true',
      [cleanEmail]
    );

    if (users.length === 0) {
      return res.status(404).json({
        status: 'error',
        message: 'Is email address par koi active account registered nahi hai. Kripya sahi email enter karein.'
      });
    }

    const user = users[0];

    // Generate secure 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = Date.now() + 15 * 60 * 1000; // 15 minutes validity

    // Store in memory
    passwordResetOtpStore.set(cleanEmail, {
      otp,
      expiresAt,
      userId: user.id,
      userName: user.full_name
    });

    // Send OTP via Nodemailer Email helper asynchronously (non-blocking)
    sendPasswordResetOtpEmail(user.email, otp, user.full_name)
      .then(sent => console.log(`📧 [Auth] Password reset OTP dispatch to ${user.email} status: ${sent}`))
      .catch(err => console.error('❌ [Auth] Password reset OTP email dispatch error:', err.message));

    return res.status(200).json({
      status: 'success',
      message: `Password reset OTP aapki email (${user.email}) par bhej diya gaya hai. Ye OTP 15 minute ke liye valid hai.`
    });
  } catch (error) {
    console.error('Request Forgot Password OTP Error:', error);
    return res.status(500).json({
      status: 'error',
      message: 'OTP generation me error aaya: ' + error.message
    });
  }
};

/**
 * 8. Verify Password Reset OTP
 * POST /api/auth/verify-reset-otp
 */
export const verifyForgotPasswordOtp = async (req, res) => {
  try {
    const { email, otp } = req.body;

    if (!email || !otp) {
      return res.status(400).json({
        status: 'error',
        message: 'Email aur OTP dono required hain.'
      });
    }

    const cleanEmail = email.trim().toLowerCase();
    const storedEntry = passwordResetOtpStore.get(cleanEmail);

    if (!storedEntry) {
      return res.status(400).json({
        status: 'error',
        message: 'OTP session expire ho chuka hai ya koi request nahi mil. Kripya naya OTP request karein.'
      });
    }

    if (Date.now() > storedEntry.expiresAt) {
      passwordResetOtpStore.delete(cleanEmail);
      return res.status(400).json({
        status: 'error',
        message: 'OTP expire ho gaya hai (15 minutes limit exceeded). Kripya Resend OTP par click karein.'
      });
    }

    if (storedEntry.otp !== otp.trim()) {
      return res.status(400).json({
        status: 'error',
        message: 'Galat OTP enter kiya gaya hai. Kripya sahi 6-digit OTP daalein.'
      });
    }

    return res.status(200).json({
      status: 'success',
      message: 'OTP safaltapoorvak verify ho gaya hai! Kripya naya password set karein.'
    });
  } catch (error) {
    console.error('Verify Reset OTP Error:', error);
    return res.status(500).json({
      status: 'error',
      message: 'OTP verification me error aaya: ' + error.message
    });
  }
};

/**
 * 9. Set New Password After OTP Verification
 * POST /api/auth/reset-password
 */
export const resetPasswordWithOtp = async (req, res) => {
  try {
    const { email, otp, newPassword } = req.body;

    if (!email || !otp || !newPassword) {
      return res.status(400).json({
        status: 'error',
        message: 'Email, OTP aur Naya Password required hain.'
      });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({
        status: 'error',
        message: 'Naya Password kam se kam 6 characters ka hona chahiye.'
      });
    }

    const cleanEmail = email.trim().toLowerCase();
    const storedEntry = passwordResetOtpStore.get(cleanEmail);

    if (!storedEntry || Date.now() > storedEntry.expiresAt) {
      passwordResetOtpStore.delete(cleanEmail);
      return res.status(400).json({
        status: 'error',
        message: 'Session expire ho gaya hai. Kripya shuru se OTP request karein.'
      });
    }

    if (storedEntry.otp !== otp.trim()) {
      return res.status(400).json({
        status: 'error',
        message: 'Galat OTP enter kiya gaya hai.'
      });
    }

    // Hash new password and update DB
    const newHash = await bcrypt.hash(newPassword, 10);
    await pool.query('UPDATE users SET password_hash = ? WHERE LOWER(email) = ?', [newHash, cleanEmail]);

    // Clean up OTP store session
    passwordResetOtpStore.delete(cleanEmail);

    // Send confirmation email
    sendPasswordChangedEmail({
      toEmail: cleanEmail,
      userName: storedEntry.userName
    }).catch(err => console.error('Reset password email error:', err.message));

    return res.status(200).json({
      status: 'success',
      message: 'Password safaltapoorvak reset ho gaya hai! Aap ab apne naye password se login kar sakte hain.'
    });
  } catch (error) {
    console.error('Reset Password Error:', error);
    return res.status(500).json({
      status: 'error',
      message: 'Password reset karne me error aaya: ' + error.message
    });
  }
};
