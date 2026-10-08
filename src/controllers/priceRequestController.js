import pool from '../config/db.js';
import { sendRateRequestAlertToAdmin, sendRateReviewDecisionEmail } from '../utils/mailer.js';

/**
 * Price Request Controller
 * Manages Operator price modification requests & Admin approvals
 */

/**
 * 1. Submit Price Change Request (Operator)
 * POST /api/services/price-requests
 */
export const createPriceRequest = async (req, res) => {
  try {
    const operatorId = req.user?.id;
    if (!operatorId || req.user?.role !== 'operator') {
      return res.status(403).json({ status: 'error', message: 'Only operators can request price updates.' });
    }

    const {
      subServiceId,
      sub_service_id,
      assignmentId,
      assignment_id,
      routingMode,
      routing_mode,
      areaOrWardLabel,
      area_or_ward_label,
      requestedPrice,
      requested_price,
      reason
    } = req.body;

    const targetSubServiceId = subServiceId || sub_service_id;
    const targetAssignmentId = assignmentId || assignment_id || null;
    const mode = routingMode || routing_mode || 'single';
    const label = areaOrWardLabel || area_or_ward_label || null;
    const newPrice = parseFloat(requestedPrice || requested_price);

    if (!targetSubServiceId) {
      return res.status(400).json({ status: 'error', message: 'Sub-Service ID is required.' });
    }

    if (isNaN(newPrice) || newPrice <= 0) {
      return res.status(400).json({ status: 'error', message: 'Kripya valid price enter karein.' });
    }

    // Check if duplicate pending request exists
    const [existing] = await pool.query(
      `SELECT id FROM operator_price_requests 
       WHERE operator_id = ? AND sub_service_id = ? AND status = 'pending' 
       AND (area_or_ward_label = ? OR (area_or_ward_label IS NULL AND ? IS NULL)) LIMIT 1`,
      [operatorId, targetSubServiceId, label, label]
    );

    if (existing.length > 0) {
      return res.status(400).json({
        status: 'error',
        message: 'Is service / location ke liye aapki ek price update request pehle se pending hai.'
      });
    }

    // Determine current price
    let currentPrice = 0.00;
    if (targetAssignmentId) {
      const [asRows] = await pool.query(
        'SELECT custom_fee FROM operator_assignments WHERE id = ?',
        [targetAssignmentId]
      );
      if (asRows.length > 0 && asRows[0].custom_fee !== null) {
        currentPrice = parseFloat(asRows[0].custom_fee);
      }
    }

    if (currentPrice === 0) {
      const [ssRows] = await pool.query(
        'SELECT fee FROM sub_services WHERE id = ?',
        [targetSubServiceId]
      );
      if (ssRows.length > 0) {
        currentPrice = parseFloat(ssRows[0].fee || 0);
      }
    }

    // Insert dummy record to get insertId
    const [insRes] = await pool.query(
      `INSERT INTO operator_price_requests (
        request_no, operator_id, sub_service_id, assignment_id, routing_mode,
        area_or_ward_label, current_price, requested_price, reason, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
      [
        'PRQ-TEMP',
        operatorId,
        targetSubServiceId,
        targetAssignmentId,
        mode,
        label,
        currentPrice,
        newPrice,
        reason || 'Price adjustment request by Operator'
      ]
    );

    const year = new Date().getFullYear();
    const reqNo = `PRQ-${year}-${1000 + insRes.insertId}`;
    await pool.query('UPDATE operator_price_requests SET request_no = ? WHERE id = ?', [reqNo, insRes.insertId]);

    // Send Rate Request Alert to Admin (non-blocking)
    pool.query('SELECT name FROM sub_services WHERE id = ?', [targetSubServiceId])
      .then(([subRows]) => {
        const sName = subRows.length > 0 ? subRows[0].name : 'Government Service';
        sendRateRequestAlertToAdmin({
          operatorName: req.user?.full_name || 'Operator',
          serviceName: sName,
          requestedRate: newPrice,
          currentPrice
        }).catch(err => console.error('Rate request admin alert email error:', err.message));
      })
      .catch(err => console.error('Fetch service for rate request email error:', err.message));

    return res.status(201).json({
      status: 'success',
      message: `Price update request "${reqNo}" submitted successfully! Sent to Admin for verification.`,
      data: {
        id: insRes.insertId,
        requestNo: reqNo,
        currentPrice,
        requestedPrice: newPrice,
        status: 'pending'
      }
    });
  } catch (error) {
    console.error('Create Price Request Error:', error);
    return res.status(500).json({ status: 'error', message: error.message });
  }
};

/**
 * 2. Get Price Change Requests (Operator / Admin)
 * GET /api/services/price-requests
 */
export const getPriceRequests = async (req, res) => {
  try {
    const userRole = req.user?.role;
    const userId = req.user?.id;
    const { status } = req.query;

    let query = `
      SELECT 
        pr.id,
        pr.request_no as requestNo,
        pr.operator_id as operatorId,
        pr.sub_service_id as subServiceId,
        pr.assignment_id as assignmentId,
        pr.routing_mode as routingMode,
        pr.area_or_ward_label as areaOrWardLabel,
        pr.current_price as currentPrice,
        pr.requested_price as requestedPrice,
        pr.reason,
        pr.status,
        pr.admin_remarks as adminRemarks,
        pr.created_at as createdAt,
        pr.reviewed_at as reviewedAt,
        u_op.full_name as operatorName,
        u_op.mobile as operatorMobile,
        ss.name as subServiceName,
        ss.code as subServiceCode,
        COALESCE(ss.admin_commission_percentage, s.admin_commission_percentage, 0.00) as adminCommissionPercent,
        COALESCE(s.name, ss.name) as serviceName
      FROM operator_price_requests pr
      JOIN users u_op ON pr.operator_id = u_op.id
      JOIN sub_services ss ON pr.sub_service_id = ss.id
      LEFT JOIN services s ON ss.service_id = s.id
      WHERE 1=1
    `;

    const params = [];

    if (userRole === 'operator') {
      query += ' AND pr.operator_id = ?';
      params.push(userId);
    }

    if (status) {
      query += ' AND pr.status = ?';
      params.push(status);
    }

    query += ' ORDER BY pr.created_at DESC';

    const [rows] = await pool.query(query, params);

    const formatted = rows.map(r => {
      const comm = parseFloat(r.adminCommissionPercent || 0);
      const currTotal = parseFloat(r.currentPrice);
      const reqTotal = parseFloat(r.requestedPrice);
      const currShare = currTotal - (currTotal * comm) / 100;
      const reqShare = reqTotal - (reqTotal * comm) / 100;

      return {
        id: r.id.toString(),
        requestNo: r.requestNo,
        operatorId: r.operatorId.toString(),
        operatorName: r.operatorName,
        operatorMobile: r.operatorMobile,
        subServiceId: r.subServiceId.toString(),
        subServiceName: r.subServiceName,
        subServiceCode: r.subServiceCode,
        serviceName: r.serviceName,
        assignmentId: r.assignmentId ? r.assignmentId.toString() : null,
        routingMode: r.routingMode,
        areaOrWardLabel: r.areaOrWardLabel || 'Default Service',
        currentPrice: currTotal,
        requestedPrice: reqTotal,
        adminCommissionPercent: comm,
        currentOperatorShare: currShare,
        requestedOperatorShare: reqShare,
        reason: r.reason,
        status: r.status,
        adminRemarks: r.adminRemarks,
        createdAt: r.createdAt,
        reviewedAt: r.reviewedAt
      };
    });

    return res.status(200).json({ status: 'success', data: formatted });
  } catch (error) {
    console.error('Get Price Requests Error:', error);
    return res.status(500).json({ status: 'error', message: error.message });
  }
};

/**
 * 3. Review Price Change Request (Admin / Manager)
 * PATCH /api/services/price-requests/:id/review
 */
export const reviewPriceRequest = async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const { id } = req.params;
    const { status, adminRemarks, admin_remarks, approvedPrice, approved_price, requestedPrice, requested_price } = req.body;
    const reviewerId = req.user?.id;
    const remarks = adminRemarks || admin_remarks || '';

    if (!['approved', 'rejected'].includes(status)) {
      return res.status(400).json({ status: 'error', message: 'Status must be "approved" or "rejected".' });
    }

    await connection.beginTransaction();

    // Lock price request record
    const [requests] = await connection.query(
      `SELECT * FROM operator_price_requests WHERE id = ? FOR UPDATE`,
      [id]
    );

    if (requests.length === 0) {
      throw new Error('Price request not found.');
    }

    const pr = requests[0];
    if (pr.status !== 'pending') {
      throw new Error(`This price request has already been ${pr.status}.`);
    }

    // Determine final price to apply (use custom admin override if provided, else requested price)
    let finalApprovedPrice = parseFloat(pr.requested_price);
    const customInput = parseFloat(approvedPrice || approved_price || requestedPrice || requested_price);
    if (!isNaN(customInput) && customInput > 0) {
      finalApprovedPrice = customInput;
    }

    // Update price request status & requested_price if modified by Admin
    await connection.query(
      `UPDATE operator_price_requests 
       SET status = ?, requested_price = ?, admin_remarks = ?, reviewed_by = ?, reviewed_at = NOW() 
       WHERE id = ?`,
      [status, finalApprovedPrice, remarks, reviewerId, id]
    );

    // If approved, update effective price in database for assignment, sub_service, and parent service
    if (status === 'approved') {
      const subId = pr.sub_service_id;

      if (pr.assignment_id) {
        // Update specific area or ward operator assignment custom fee
        await connection.query(
          'UPDATE operator_assignments SET custom_fee = ? WHERE id = ?',
          [finalApprovedPrice, pr.assignment_id]
        );
      }

      if (subId) {
        // Update sub_services table fee
        await connection.query(
          'UPDATE sub_services SET fee = ? WHERE id = ?',
          [finalApprovedPrice, subId]
        );
        // Sync operator_assignments custom_fee for this sub_service
        await connection.query(
          'UPDATE operator_assignments SET custom_fee = ? WHERE sub_service_id = ?',
          [finalApprovedPrice, subId]
        );
        // Sync parent services table fee
        await connection.query(
          'UPDATE services SET fee = ? WHERE id = (SELECT service_id FROM sub_services WHERE id = ?)',
          [finalApprovedPrice, subId]
        );
      }
    }

    await connection.commit();

    // Send Rate Change Decision Email to Operator (non-blocking)
    pool.query(
      `SELECT u.full_name, u.email, ss.name as serviceName 
       FROM users u 
       LEFT JOIN sub_services ss ON ss.id = ? 
       WHERE u.id = ?`,
      [pr.sub_service_id, pr.operator_id]
    ).then(([uRows]) => {
      if (uRows.length > 0 && uRows[0].email) {
        sendRateReviewDecisionEmail({
          toEmail: uRows[0].email,
          operatorName: uRows[0].full_name,
          serviceName: uRows[0].serviceName || 'Government Service',
          approvedRate: finalApprovedPrice,
          status
        }).catch(err => console.error('Rate review decision email error:', err.message));
      }
    }).catch(err => console.error('Fetch operator for rate decision email error:', err.message));

    return res.status(200).json({
      status: 'success',
      message: `Price change request "${pr.request_no}" ${status === 'approved' ? 'APPROVED & updated in system' : 'REJECTED'} successfully!`
    });
  } catch (error) {
    await connection.rollback();
    console.error('Review Price Request Error:', error);
    return res.status(500).json({ status: 'error', message: error.message });
  } finally {
    connection.release();
  }
};
