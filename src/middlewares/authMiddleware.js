import { verifyToken } from '../utils/jwt.js';
import pool from '../config/db.js';

/**
 * Middleware: Verify JWT Bearer Token & Attach User to req.user
 */
export const authenticateToken = async (req, res, next) => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.split(' ')[1] : null;

    if (!token) {
      return res.status(401).json({
        status: 'error',
        message: 'Access Denied. Authorization token missing.'
      });
    }

    const decoded = verifyToken(token);
    if (!decoded) {
      return res.status(403).json({
        status: 'error',
        message: 'Invalid or expired token. Please login again.'
      });
    }

    // Verify user exists and is active in database
    const [rows] = await pool.query(
      'SELECT id, uuid, role, full_name, mobile, email, shop_name, district, tehsil, ward_no, approval_status, is_active, is_online FROM users WHERE id = ?',
      [decoded.id]
    );

    if (rows.length === 0) {
      return res.status(401).json({
        status: 'error',
        message: 'User account not found.'
      });
    }

    const user = rows[0];

    if (!user.is_active) {
      return res.status(403).json({
        status: 'error',
        message: 'Aapka account suspended / deactivated hai. Kripya Admin se sampark karein.'
      });
    }

    if (user.approval_status !== 'approved') {
      return res.status(403).json({
        status: 'error',
        message: 'Aapka account approval ke liye pending hai. Approval ke baad hi access milega.'
      });
    }

    req.user = user;
    next();
  } catch (error) {
    console.error('Auth Middleware Error:', error);
    return res.status(500).json({
      status: 'error',
      message: 'Authentication verification failed.'
    });
  }
};

/**
 * Middleware: Role-Based Authorization Guard
 * @param  {...string} allowedRoles Allowed roles (e.g. 'super_admin', 'manager', 'operator', 'agent', 'distributor')
 */
export const authorizeRoles = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user || !allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        status: 'error',
        message: `Forbidden: Aapko is resource ko access karne ki permission nahi hai. Required: [${allowedRoles.join(', ')}]`
      });
    }
    next();
  };
};
