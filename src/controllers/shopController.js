import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import pool from '../config/db.js';
import { sendUserApprovalEmail } from '../utils/mailer.js';

// Security Multi-Tenant: Distributor sirf apne register kiye hue agents par action le sakta hai
const isOutsideDistributorScope = (req, target) =>
  req.user?.role === 'distributor' &&
  (!target.distributor_id || Number(target.distributor_id) !== Number(req.user.id));

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
             u.distributor_id as distributorId,
             d.full_name as distributorName,
             d.mobile as distributorMobile,
             ur.reason as deleteReason, ur.status as deleteRequestStatus
      FROM users u
      LEFT JOIN shops s ON u.id = s.user_id
      LEFT JOIN users d ON u.distributor_id = d.id
      LEFT JOIN user_requests ur ON u.id = ur.target_user_id AND ur.status = 'pending' AND ur.request_type = 'delete_agent'
      WHERE u.role = 'agent'
    `;

    const params = [];

    // Security: Distributor sirf aur sirf apne dwara add kiye gaye shops hi dekhega
    if (req.user?.role === 'distributor') {
      query += ' AND u.distributor_id = ?';
      params.push(req.user.id);
    }

    if (status) {
      if (status === 'active') {
        query += " AND u.is_active = true AND u.approval_status = 'approved' AND ur.id IS NULL";
      } else if (status === 'pending') {
        query += " AND u.approval_status = 'pending'";
      } else if (status === 'delete_requested') {
        query += " AND ur.id IS NOT NULL AND ur.status = 'pending'";
      } else if (status === 'inactive') {
        query += " AND (u.is_active = false OR u.approval_status = 'rejected')";
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
      distributorId: r.distributorId ? r.distributorId.toString() : null,
      distributorName: r.distributorName || null,
      distributorMobile: r.distributorMobile || null,
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
    // Distributor dwara banaya agent usi distributor ke network me link hoga
    const isDistributor = req.user?.role === 'distributor';
    const distributorId = isDistributor ? req.user.id : null;
    // Distributor dwara add ki gayi shop PENDING rahegi, Admin verify karke approve karega
    const approvalStatus = isDistributor ? 'pending' : 'approved';
    const isActive = isDistributor ? false : true;
    const shopTableStatus = isDistributor ? 'pending' : 'active';

    await connection.beginTransaction();

    // 1. Insert into users table (role = agent) for login authentication
    const [userRes] = await connection.query(
      `INSERT INTO users (
        uuid, role, full_name, mobile, email, password_hash, shop_name,
        aadhaar_number, address, distributor_id, approval_status, is_active
      ) VALUES (?, 'agent', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [uuid, ownerName, mobile.trim(), email || null, passwordHash, shopName, aadhaar || null, address, distributorId, approvalStatus, isActive]
    );

    const newUserId = userRes.insertId;
    const year = new Date().getFullYear();
    const shopCode = `SHOP-${year}-${1000 + newUserId}`;

    // 2. Insert into dedicated shops table
    await connection.query(
      `INSERT INTO shops (
        shop_id_code, user_id, owner_name, shop_name, mobile, email,
        aadhaar_number, full_address, distributor_id, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [shopCode, newUserId, ownerName, shopName, mobile.trim(), email || null, aadhaar || null, address, distributorId, shopTableStatus]
    );

    // 3. Create wallet
    await connection.query('INSERT INTO wallets (user_id, balance) VALUES (?, 0.00)', [newUserId]);

    await connection.commit();

    return res.status(201).json({
      status: 'success',
      message: isDistributor
        ? `Shop registration request for "${shopName}" submitted successfully! Sent to Admin for verification and approval.`
        : 'Shop created & activated successfully! Shop user can now log in.',
      data: {
        id: newUserId.toString(),
        shopCode,
        ownerName,
        shopName,
        mobile,
        status: isDistributor ? 'PENDING' : 'ACTIVE'
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

    const [users] = await connection.query('SELECT full_name, email, role, distributor_id FROM users WHERE id = ? FOR UPDATE', [id]);

    // Shop endpoints sirf Agent (shop) accounts par kaam karenge
    if (users.length === 0 || users[0].role !== 'agent' || isOutsideDistributorScope(req, users[0])) {
      await connection.rollback();
      return res.status(404).json({ status: 'error', message: 'Shop not found.' });
    }

    await connection.query(
      'UPDATE users SET approval_status = ?, is_active = true WHERE id = ?',
      ['approved', id]
    );

    // Distributor ne verify kiya -> agent uske network me link
    if (req.user?.role === 'distributor' && !users[0].distributor_id) {
      await connection.query('UPDATE users SET distributor_id = ? WHERE id = ?', [req.user.id, id]);
      await connection.query('UPDATE shops SET distributor_id = ? WHERE user_id = ?', [req.user.id, id]);
    }

    await connection.query(
      'UPDATE shops SET status = ? WHERE user_id = ?',
      ['active', id]
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

    const [users] = await connection.query('SELECT full_name, email, role, distributor_id FROM users WHERE id = ? FOR UPDATE', [id]);

    // Shop endpoints sirf Agent (shop) accounts par kaam karenge
    if (users.length === 0 || users[0].role !== 'agent' || isOutsideDistributorScope(req, users[0])) {
      await connection.rollback();
      return res.status(404).json({ status: 'error', message: 'Shop not found.' });
    }

    await connection.query(
      'UPDATE users SET approval_status = ?, is_active = false WHERE id = ?',
      ['rejected', id]
    );

    await connection.query(
      'UPDATE shops SET status = ? WHERE user_id = ?',
      ['rejected', id]
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

    const requestedBy = req.user.id;

    const [targets] = await pool.query("SELECT id, distributor_id FROM users WHERE id = ? AND role = 'agent'", [id]);
    if (targets.length === 0 || isOutsideDistributorScope(req, targets[0])) {
      return res.status(404).json({ status: 'error', message: 'Shop not found.' });
    }

    // Duplicate pending request se bachav
    const [existingReq] = await pool.query(
      "SELECT id FROM user_requests WHERE target_user_id = ? AND request_type = 'delete_agent' AND status = 'pending' LIMIT 1",
      [id]
    );
    if (existingReq.length > 0) {
      return res.status(400).json({ status: 'error', message: 'Is shop ke liye deletion request pehle se pending hai.' });
    }

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
    const reviewedBy = req.user.id;

    await connection.beginTransaction();

    const [targets] = await connection.query("SELECT id FROM users WHERE id = ? AND role = 'agent' FOR UPDATE", [id]);
    if (targets.length === 0) {
      await connection.rollback();
      return res.status(404).json({ status: 'error', message: 'Shop not found.' });
    }

    // Deactivate shop user safely with parameters (avoid SQL double quote identifier errors)
    await connection.query(
      'UPDATE users SET is_active = false, approval_status = ? WHERE id = ?',
      ['rejected', id]
    );

    // Update shops table status as well
    await connection.query(
      'UPDATE shops SET status = ? WHERE user_id = ?',
      ['rejected', id]
    );

    // Mark request approved with parameters
    await connection.query(
      'UPDATE user_requests SET status = ?, reviewed_by = ?, reviewed_at = NOW() WHERE target_user_id = ? AND request_type = ? AND status = ?',
      ['approved', reviewedBy, id, 'delete_agent', 'pending']
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

/**
 * 7. Permanently Delete Shop (Admin)
 * DELETE /api/shops/:id
 */
export const deleteShop = async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const { id } = req.params;

    await connection.beginTransaction();

    // 1. Identify shop and user (agent)
    const [shops] = await connection.query(
      'SELECT s.id as shop_id, s.user_id FROM shops s WHERE s.id = ? OR s.user_id = ?',
      [id, id]
    );

    let agentId = null;
    let shopId = null;

    if (shops.length > 0) {
      shopId = shops[0].shop_id;
      agentId = shops[0].user_id;
    } else {
      const [agents] = await connection.query("SELECT id FROM users WHERE id = ? AND role = 'agent'", [id]);
      if (agents.length === 0) {
        await connection.rollback();
        return res.status(404).json({ status: 'error', message: 'Shop not found.' });
      }
      agentId = agents[0].id;
    }

    // 2. Cascade cleanup all foreign keys cleanly
    if (agentId) {
      // Application documents and applications
      await connection.query(
        'DELETE FROM application_documents WHERE application_id IN (SELECT id FROM applications WHERE agent_id = ?)',
        [agentId]
      );
      await connection.query('DELETE FROM applications WHERE agent_id = ?', [agentId]);

      // Complaints raised by agent
      await connection.query('DELETE FROM complaints WHERE raised_by = ?', [agentId]);

      // User requests for or by agent
      await connection.query('DELETE FROM user_requests WHERE target_user_id = ? OR requested_by = ?', [agentId, agentId]);

      // Transactions & withdrawal requests
      await connection.query('DELETE FROM transactions WHERE user_id = ?', [agentId]);
      await connection.query('DELETE FROM withdrawal_requests WHERE user_id = ?', [agentId]);

      // Wallet
      await connection.query('DELETE FROM wallets WHERE user_id = ?', [agentId]);

      // Shop entry
      await connection.query('DELETE FROM shops WHERE user_id = ? OR id = ?', [agentId, shopId || 0]);

      // User entry
      await connection.query('DELETE FROM users WHERE id = ?', [agentId]);
    } else if (shopId) {
      await connection.query('DELETE FROM shops WHERE id = ?', [shopId]);
    }

    await connection.commit();

    return res.status(200).json({ status: 'success', message: 'Shop and associated account deleted permanently.' });
  } catch (error) {
    await connection.rollback();
    console.error('Delete Shop Error:', error);
    return res.status(500).json({ status: 'error', message: error.message });
  } finally {
    connection.release();
  }
};
