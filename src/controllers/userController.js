import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import pool from '../config/db.js';
import { sendUserCreatedEmail, sendUserApprovalEmail, sendDistributorUserAddedAlertToAdmin } from '../utils/mailer.js';

// Role hierarchy: user sirf apne se neeche rank wale accounts create / modify kar sakta hai
const ROLE_RANK = { super_admin: 4, sub_admin: 3, manager: 2, distributor: 1, operator: 1, agent: 1 };
const canManageRole = (callerRole, targetRole) =>
  (ROLE_RANK[callerRole] || 0) > (ROLE_RANK[targetRole] || 0);

/**
 * Target user fetch karke check karta hai ki caller usko manage kar sakta hai ya nahi.
 * Returns { error } (HTTP response ke liye) ya { target }.
 */
const checkManageTarget = async (req, id) => {
  const [rows] = await pool.query('SELECT id, role FROM users WHERE id = ?', [id]);
  if (rows.length === 0) return { error: { code: 404, message: 'User not found.' } };
  if (Number(rows[0].id) === Number(req.user?.id)) {
    return { error: { code: 403, message: 'Aap apne khud ke account par ye action nahi kar sakte.' } };
  }
  if (!canManageRole(req.user?.role, rows[0].role)) {
    return { error: { code: 403, message: 'Aapko is user ko manage karne ki permission nahi hai.' } };
  }
  return { target: rows[0] };
};

/**
 * 1. Get Users List (Filter by role)
 * GET /api/users?role=distributor,manager,sub_admin
 */
export const getUsers = async (req, res) => {
  try {
    const { role } = req.query;

    let query = `
      SELECT u.id, u.uuid, u.role, u.full_name, u.mobile, u.email,
             u.aadhaar_number, u.district, u.tehsil, u.ward_no, u.address,
             u.shop_name, u.approval_status, u.is_active, u.is_online,
             u.last_login_at, u.created_at,
             w.balance as wallet_balance
      FROM users u
      LEFT JOIN wallets w ON u.id = w.user_id
    `;

    const params = [];

    if (role) {
      const roles = role.split(',').map(r => r.trim());
      query += ` WHERE u.role IN (${roles.map(() => '?').join(',')})`;
      params.push(...roles);
    }

    query += ' ORDER BY u.created_at DESC';

    const [rows] = await pool.query(query, params);

    const year = new Date().getFullYear();
    const formatted = rows.map(r => ({
      id: r.id.toString(),
      uuid: r.uuid,
      role: r.role,
      fullName: r.full_name,
      mobile: r.mobile,
      email: r.email || '',
      aadhaar: r.aadhaar_number || '',
      district: r.district || '',
      tehsil: r.tehsil || '',
      wardNo: r.ward_no || '',
      address: r.address || '',
      officeName: r.shop_name || '',
      approvalStatus: r.approval_status,
      isActive: !!r.is_active,
      isOnline: !!r.is_online,
      walletBalance: parseFloat(r.wallet_balance || 0),
      userCode: `USR-${year}-${1000 + r.id}`,
      lastLoginAt: r.last_login_at
        ? new Date(r.last_login_at).toLocaleString('en-IN', {
            day: '2-digit', month: 'short', year: 'numeric',
            hour: '2-digit', minute: '2-digit', hour12: true
          })
        : null,
      createdAt: new Date(r.created_at).toLocaleString('en-IN', {
        day: '2-digit', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit', hour12: true
      })
    }));

    return res.status(200).json({ status: 'success', data: formatted });
  } catch (error) {
    console.error('Get Users Error:', error);
    return res.status(500).json({ status: 'error', message: error.message });
  }
};

/**
 * 2. Create New User (Distributor / Manager / Sub Admin / Operator)
 * POST /api/users
 */
export const createUser = async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const {
      fullName, mobile, email, password, role,
      aadhaar, district, tehsil, wardNo, address, officeName
    } = req.body;

    if (!fullName || !mobile || !password || !role) {
      return res.status(400).json({
        status: 'error',
        message: 'Name, Mobile, Password, and Role are required.'
      });
    }

    if (!['distributor', 'manager', 'sub_admin', 'operator'].includes(role)) {
      return res.status(400).json({
        status: 'error',
        message: 'Invalid role. Allowed: distributor, manager, sub_admin, operator'
      });
    }

    if (!canManageRole(req.user?.role, role)) {
      return res.status(403).json({
        status: 'error',
        message: 'Aap apne barabar ya upar ke role ka account create nahi kar sakte.'
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

    const [result] = await connection.query(
      `INSERT INTO users (
        uuid, role, full_name, mobile, email, password_hash, aadhaar_number,
        district, tehsil, ward_no, address, shop_name, approval_status, is_active
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'approved', true)`,
      [
        uuid, role, fullName, mobile.trim(), email || null, passwordHash,
        aadhaar || null, district || null, tehsil || null, wardNo || null,
        address || null, officeName || null
      ]
    );

    const newUserId = result.insertId;

    await connection.commit();

    // 1. Send Welcome Email to newly created user
    if (email) {
      sendUserCreatedEmail({
        toEmail: email,
        name: fullName,
        role,
        mobile: mobile.trim(),
        tempPassword: password,
        createdByRole: req.user?.role || 'Admin'
      }).catch(err => console.error('Create user email error:', err.message));
    }

    // 2. If created by Distributor, notify Admin
    if (req.user?.role === 'distributor') {
      sendDistributorUserAddedAlertToAdmin({
        distributorName: req.user.full_name || 'Distributor',
        newUserName: fullName,
        newUserRole: role,
        newUserMobile: mobile.trim()
      }).catch(err => console.error('Distributor user creation admin alert error:', err.message));
    }

    const roleLabels = {
      distributor: 'Distributor',
      manager: 'Manager',
      sub_admin: 'Sub Admin',
      operator: 'Operator'
    };

    return res.status(201).json({
      status: 'success',
      message: `${roleLabels[role] || role} "${fullName}" successfully created!`,
      data: { id: newUserId.toString(), uuid, role, fullName, mobile: mobile.trim() }
    });
  } catch (error) {
    await connection.rollback();
    console.error('Create User Error:', error);
    return res.status(500).json({ status: 'error', message: error.message });
  } finally {
    connection.release();
  }
};

/**
 * 3. Update User Details
 * PATCH /api/users/:id
 */
export const updateUser = async (req, res) => {
  try {
    const { id } = req.params;
    const { fullName, email, aadhaar, district, tehsil, wardNo, address, officeName } = req.body;

    const check = await checkManageTarget(req, id);
    if (check.error) {
      return res.status(check.error.code).json({ status: 'error', message: check.error.message });
    }

    const updates = [];
    const params = [];

    if (fullName) { updates.push('full_name = ?'); params.push(fullName); }
    if (email !== undefined) { updates.push('email = ?'); params.push(email || null); }
    if (aadhaar !== undefined) { updates.push('aadhaar_number = ?'); params.push(aadhaar || null); }
    if (district !== undefined) { updates.push('district = ?'); params.push(district || null); }
    if (tehsil !== undefined) { updates.push('tehsil = ?'); params.push(tehsil || null); }
    if (wardNo !== undefined) { updates.push('ward_no = ?'); params.push(wardNo || null); }
    if (address !== undefined) { updates.push('address = ?'); params.push(address || null); }
    if (officeName !== undefined) { updates.push('shop_name = ?'); params.push(officeName || null); }

    if (updates.length === 0) {
      return res.status(400).json({ status: 'error', message: 'No fields to update.' });
    }

    params.push(id);
    await pool.query(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, params);

    return res.status(200).json({
      status: 'success',
      message: 'User details updated successfully!'
    });
  } catch (error) {
    console.error('Update User Error:', error);
    return res.status(500).json({ status: 'error', message: error.message });
  }
};

/**
 * 4. Toggle User Active/Inactive Status
 * PATCH /api/users/:id/toggle
 */
export const toggleUserStatus = async (req, res) => {
  try {
    const { id } = req.params;

    const check = await checkManageTarget(req, id);
    if (check.error) {
      return res.status(check.error.code).json({ status: 'error', message: check.error.message });
    }

    const [rows] = await pool.query('SELECT is_active, full_name FROM users WHERE id = ?', [id]);
    if (rows.length === 0) {
      return res.status(404).json({ status: 'error', message: 'User not found.' });
    }

    const newStatus = !rows[0].is_active;
    await pool.query('UPDATE users SET is_active = ? WHERE id = ?', [newStatus, id]);

    return res.status(200).json({
      status: 'success',
      message: `${rows[0].full_name} ${newStatus ? 'activated' : 'deactivated'} successfully!`,
      data: { isActive: newStatus }
    });
  } catch (error) {
    console.error('Toggle User Status Error:', error);
    return res.status(500).json({ status: 'error', message: error.message });
  }
};

/**
 * 5. Approve Pending User (Operator self-registration approval)
 * PATCH /api/users/:id/approve
 */
export const approveUser = async (req, res) => {
  const check = await checkManageTarget(req, req.params.id).catch(e => ({ error: { code: 500, message: e.message } }));
  if (check.error) {
    return res.status(check.error.code).json({ status: 'error', message: check.error.message });
  }

  const connection = await pool.getConnection();
  try {
    const { id } = req.params;
    await connection.beginTransaction();

    const [users] = await connection.query('SELECT full_name, email, role FROM users WHERE id = ?', [id]);
    if (users.length === 0) {
      await connection.rollback();
      return res.status(404).json({ status: 'error', message: 'User not found.' });
    }

    try {
      await connection.query(
        'UPDATE users SET approval_status = ?, is_active = true WHERE id = ?',
        ['approved', id]
      );
    } catch (err) {
      await connection.query(
        'UPDATE users SET is_active = true WHERE id = ?',
        [id]
      );
    }

    try {
      await connection.query(
        'UPDATE shops SET status = ? WHERE user_id = ?',
        ['active', id]
      );
    } catch (e) {}

    await connection.commit();

    if (users[0].email) {
      sendUserApprovalEmail({
        toEmail: users[0].email,
        name: users[0].full_name,
        role: users[0].role || 'operator',
        status: 'approved'
      }).catch(err => console.error('Approval email error:', err.message));
    }

    return res.status(200).json({
      status: 'success',
      message: 'User approved and activated successfully!'
    });
  } catch (error) {
    await connection.rollback();
    console.error('Approve User Error:', error);
    return res.status(500).json({ status: 'error', message: error.message });
  } finally {
    connection.release();
  }
};

/**
 * 6. Reject Pending User (Operator self-registration rejection)
 * PATCH /api/users/:id/reject
 */
export const rejectUser = async (req, res) => {
  const check = await checkManageTarget(req, req.params.id).catch(e => ({ error: { code: 500, message: e.message } }));
  if (check.error) {
    return res.status(check.error.code).json({ status: 'error', message: check.error.message });
  }

  const connection = await pool.getConnection();
  try {
    const { id } = req.params;
    await connection.beginTransaction();

    const [users] = await connection.query('SELECT full_name, email, role FROM users WHERE id = ?', [id]);
    if (users.length === 0) {
      await connection.rollback();
      return res.status(404).json({ status: 'error', message: 'User not found.' });
    }

    try {
      await connection.query(
        'UPDATE users SET approval_status = ?, is_active = false WHERE id = ?',
        ['rejected', id]
      );
    } catch (err) {
      await connection.query(
        'UPDATE users SET is_active = false WHERE id = ?',
        [id]
      );
    }

    try {
      await connection.query(
        'UPDATE shops SET status = ? WHERE user_id = ?',
        ['rejected', id]
      );
    } catch (e) {}

    await connection.commit();

    if (users[0].email) {
      sendUserApprovalEmail({
        toEmail: users[0].email,
        name: users[0].full_name,
        role: users[0].role || 'operator',
        status: 'rejected'
      }).catch(err => console.error('Rejection email error:', err.message));
    }

    return res.status(200).json({
      status: 'success',
      message: 'User registration request rejected.'
    });
  } catch (error) {
    await connection.rollback();
    console.error('Reject User Error:', error);
    return res.status(500).json({ status: 'error', message: error.message });
  } finally {
    connection.release();
  }
};

/**
 * 7. Delete / Remove User Permanently
 * DELETE /api/users/:id
 */
export const deleteUser = async (req, res) => {
  const check = await checkManageTarget(req, req.params.id).catch(e => ({ error: { code: 500, message: e.message } }));
  if (check.error) {
    return res.status(check.error.code).json({ status: 'error', message: check.error.message });
  }

  const connection = await pool.getConnection();
  try {
    const { id } = req.params;

    await connection.beginTransaction();

    // 1. Applications foreign keys
    await connection.query('UPDATE applications SET operator_id = NULL WHERE operator_id = ?', [id]);
    await connection.query('UPDATE applications SET distributor_id = NULL WHERE distributor_id = ?', [id]);
    await connection.query(
      'DELETE FROM application_documents WHERE application_id IN (SELECT id FROM applications WHERE agent_id = ?)',
      [id]
    );
    await connection.query('DELETE FROM applications WHERE agent_id = ?', [id]);

    // 2. Operator assignments & price requests
    await connection.query('DELETE FROM operator_assignments WHERE operator_id = ?', [id]);
    await connection.query('UPDATE operator_price_requests SET reviewed_by = NULL WHERE reviewed_by = ?', [id]);
    await connection.query('DELETE FROM operator_price_requests WHERE operator_id = ?', [id]);

    // 3. Complaints
    await connection.query('UPDATE complaints SET resolved_by = NULL WHERE resolved_by = ?', [id]);
    await connection.query('DELETE FROM complaints WHERE raised_by = ?', [id]);

    // 4. User requests
    await connection.query('UPDATE user_requests SET reviewed_by = NULL WHERE reviewed_by = ?', [id]);
    await connection.query('DELETE FROM user_requests WHERE target_user_id = ? OR requested_by = ?', [id, id]);

    // 5. Withdrawal requests
    await connection.query('UPDATE withdrawal_requests SET verified_by = NULL WHERE verified_by = ?', [id]);
    await connection.query('UPDATE withdrawal_requests SET processed_by = NULL WHERE processed_by = ?', [id]);
    await connection.query('DELETE FROM withdrawal_requests WHERE user_id = ?', [id]);

    // 6. Wallets & Transactions
    await connection.query('DELETE FROM transactions WHERE user_id = ?', [id]);
    await connection.query('DELETE FROM wallets WHERE user_id = ?', [id]);

    // 7. Shops linking
    await connection.query('DELETE FROM shops WHERE user_id = ?', [id]);
    await connection.query('UPDATE shops SET distributor_id = NULL WHERE distributor_id = ?', [id]);
    await connection.query('UPDATE users SET distributor_id = NULL WHERE distributor_id = ?', [id]);

    // 8. Delete user record
    await connection.query('DELETE FROM users WHERE id = ?', [id]);

    await connection.commit();

    return res.status(200).json({
      status: 'success',
      message: 'User removed successfully.'
    });
  } catch (error) {
    await connection.rollback();
    console.error('Delete User Error:', error);
    return res.status(500).json({ status: 'error', message: error.message });
  } finally {
    connection.release();
  }
};
