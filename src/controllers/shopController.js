import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import pool from '../config/db.js';
import { sendUserApprovalEmail } from '../utils/mailer.js';

/**
 * 1. Get All Shops with Status Filters
 * GET /api/shops
 */
export const getShops = async (req, res) => {
  try {
    const { status } = req.query;

    let query = `
      SELECT u.id, u.uuid as userUuid, s.shop_id_code as shopCode, u.full_name as ownerName,
             COALESCE(s.shop_name, u.shop_name) as shopName,
             u.mobile, u.email, u.aadhaar_number as aadhaar, u.address,
             u.approval_status, u.is_active, u.created_at as createdAt,
             ur.reason as deleteReason, ur.status as deleteRequestStatus
      FROM users u
      LEFT JOIN shops s ON u.id = s.user_id
      LEFT JOIN user_requests ur ON u.id = ur.target_user_id AND ur.status = 'pending' AND ur.request_type = 'delete_agent'
      WHERE u.role = 'agent'
    `;

    const params = [];
    if (status) {
      if (status === 'active') {
        query += ' AND u.is_active = true AND u.approval_status = "approved" AND ur.id IS NULL';
      } else if (status === 'pending') {
        query += ' AND u.approval_status = "pending"';
      } else if (status === 'delete_requested') {
        query += ' AND ur.id IS NOT NULL AND ur.status = "pending"';
      } else if (status === 'inactive') {
        query += ' AND (u.is_active = false OR u.approval_status = "rejected")';
      }
    }

    query += ' ORDER BY u.created_at DESC';

    const [rows] = await pool.query(query, params);

    const year = new Date().getFullYear();
    const formattedShops = rows.map((r, idx) => ({
      id: r.id.toString(),
      shopCode: r.shopCode || `SHOP-${year}-${1000 + r.id}`,
      ownerName: r.ownerName,
      shopName: r.shopName || `${r.ownerName} Kiosk`,
      mobile: r.mobile,
      email: r.email || 'N/A',
      aadhaar: r.aadhaar || 'N/A',
      address: r.address || 'N/A',
      status: r.deleteRequestStatus === 'pending'
        ? 'DELETE_REQUESTED'
        : r.approval_status === 'pending'
        ? 'PENDING'
        : r.is_active && r.approval_status === 'approved'
        ? 'ACTIVE'
        : 'INACTIVE',
      deleteReason: r.deleteReason || undefined,
      createdAt: new Date(r.createdAt).toLocaleString('en-IN', {
        day: '2-digit', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit', hour12: true
      })
    }));

    return res.status(200).json({
      status: 'success',
      data: formattedShops
    });
  } catch (error) {
    console.error('Get Shops Error:', error);
    return res.status(500).json({ status: 'error', message: error.message });
  }
};

/**
 * 2. Add New Shop Direct (Distributor / Admin)
 * POST /api/shops
 */
export const addShop = async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const { ownerName, shopName, mobile, email, aadhaar, address, password } = req.body;

    if (!ownerName || !shopName || !mobile || !address || !password) {
      return res.status(400).json({
        status: 'error',
        message: 'Owner name, Shop name, Mobile, Address, and Password are required.'
      });
    }

    // Check duplicate mobile
    const [existing] = await connection.query('SELECT id FROM users WHERE mobile = ?', [mobile.trim()]);
    if (existing.length > 0) {
      return res.status(400).json({
        status: 'error',
        message: 'Ye mobile number pehle se registered hai.'
      });
    }

    const uuid = crypto.randomUUID();
    const passwordHash = await bcrypt.hash(password, 10);

    await connection.beginTransaction();

    // 1. Insert into users table (role = agent) for login authentication
    const [userRes] = await connection.query(
      `INSERT INTO users (
        uuid, role, full_name, mobile, email, password_hash, shop_name,
        aadhaar_number, address, approval_status, is_active
      ) VALUES (?, 'agent', ?, ?, ?, ?, ?, ?, ?, 'approved', true)`,
      [uuid, ownerName, mobile.trim(), email || null, passwordHash, shopName, aadhaar || null, address]
    );

    const newUserId = userRes.insertId;
    const year = new Date().getFullYear();
    const shopCode = `SHOP-${year}-${1000 + newUserId}`;

    // 2. Insert into dedicated shops table
    await connection.query(
      `INSERT INTO shops (
        shop_id_code, user_id, owner_name, shop_name, mobile, email,
        aadhaar_number, full_address, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active')`,
      [shopCode, newUserId, ownerName, shopName, mobile.trim(), email || null, aadhaar || null, address]
    );

    // 3. Create wallet
    await connection.query('INSERT INTO wallets (user_id, balance) VALUES (?, 0.00)', [newUserId]);

    await connection.commit();

    return res.status(201).json({
      status: 'success',
      message: 'Shop created & activated successfully! Shop user can now log in.',
      data: {
        id: newUserId.toString(),
        shopCode,
        ownerName,
        shopName,
        mobile,
        status: 'ACTIVE'
      }
    });
  } catch (error) {
    await connection.rollback();
    console.error('Add Shop Error:', error);
    return res.status(500).json({ status: 'error', message: error.message });
  } finally {
    connection.release();
  }
};

/**
 * 3. Approve / Activate Shop (Admin)
 * PATCH /api/shops/:id/approve
 */
export const approveShop = async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const { id } = req.params;
    await connection.beginTransaction();

    const [users] = await connection.query('SELECT full_name, email, role FROM users WHERE id = ?', [id]);

    await connection.query(
      'UPDATE users SET approval_status = ?, is_active = true WHERE id = ?',
      ['approved', id]
    );

    await connection.query(
      'UPDATE shops SET status = ? WHERE user_id = ? OR id = ?',
      ['active', id, id]
    );

    await connection.query(
      'UPDATE user_requests SET status = ? WHERE target_user_id = ? AND request_type = ? AND status = ?',
      ['rejected', id, 'delete_agent', 'pending']
    );

    await connection.commit();

    if (users.length > 0 && users[0].email) {
      sendUserApprovalEmail({
        toEmail: users[0].email,
        name: users[0].full_name,
        role: users[0].role || 'agent',
        status: 'approved'
      }).catch(err => console.error('Shop approval email error:', err.message));
    }

    return res.status(200).json({ status: 'success', message: 'Shop approved and activated successfully!' });
  } catch (error) {
    await connection.rollback();
    console.error('Approve Shop Error:', error);
    return res.status(500).json({ status: 'error', message: error.message });
  } finally {
    connection.release();
  }
};

/**
 * 4. Reject / Deactivate Shop (Admin)
 * PATCH /api/shops/:id/reject
 */
export const rejectShop = async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const { id } = req.params;
    await connection.beginTransaction();

    const [users] = await connection.query('SELECT full_name, email, role FROM users WHERE id = ?', [id]);

    await connection.query(
      'UPDATE users SET approval_status = ?, is_active = false WHERE id = ?',
      ['rejected', id]
    );

    await connection.query(
      'UPDATE shops SET status = ? WHERE user_id = ? OR id = ?',
      ['rejected', id, id]
    );

    await connection.commit();

    if (users.length > 0 && users[0].email) {
      sendUserApprovalEmail({
        toEmail: users[0].email,
        name: users[0].full_name,
        role: users[0].role || 'agent',
        status: 'rejected'
      }).catch(err => console.error('Shop rejection email error:', err.message));
    }

    return res.status(200).json({ status: 'success', message: 'Shop deactivated and login blocked.' });
  } catch (error) {
    await connection.rollback();
    console.error('Reject Shop Error:', error);
    return res.status(500).json({ status: 'error', message: error.message });
  } finally {
    connection.release();
  }
};

/**
 * 5. Request Shop Deletion (Distributor)
 * POST /api/shops/:id/request-delete
 */
export const requestDeleteShop = async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    if (!reason) {
      return res.status(400).json({ status: 'error', message: 'Reason for deletion is required.' });
    }

    const requestedBy = req.user?.id || 1;

    await pool.query(
      `INSERT INTO user_requests (requested_by, target_user_id, request_type, reason, status)
       VALUES (?, ?, 'delete_agent', ?, 'pending')`,
      [requestedBy, id, reason]
    );

    return res.status(200).json({ status: 'success', message: 'Deletion request submitted to Admin successfully.' });
  } catch (error) {
    console.error('Request Delete Error:', error);
    return res.status(500).json({ status: 'error', message: error.message });
  }
};

/**
 * 6. Approve Shop Deletion (Admin) -> Deactivates Shop & Blocks Login
 * PATCH /api/shops/:id/approve-deletion
 */
export const approveDeletion = async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const { id } = req.params;
    const reviewedBy = req.user?.id || 1;

    await connection.beginTransaction();

    // Deactivate shop user
    await connection.query('UPDATE users SET is_active = false, approval_status = "rejected" WHERE id = ?', [id]);

    // Mark request approved
    await connection.query(
      'UPDATE user_requests SET status = "approved", reviewed_by = ?, reviewed_at = NOW() WHERE target_user_id = ? AND request_type = "delete_agent"',
      [reviewedBy, id]
    );

    await connection.commit();

    return res.status(200).json({ status: 'success', message: 'Shop deletion approved. Shop deactivated and login blocked.' });
  } catch (error) {
    await connection.rollback();
    console.error('Approve Deletion Error:', error);
    return res.status(500).json({ status: 'error', message: error.message });
  } finally {
    connection.release();
  }
};
