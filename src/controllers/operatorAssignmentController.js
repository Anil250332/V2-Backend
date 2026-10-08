import pool from '../config/db.js';

/**
 * 1. Get Operator Assignments (with filters)
 * GET /api/operator-assignments
 * Query params: operator_id, service_id, sub_service_id
 */
export const getAssignments = async (req, res) => {
  try {
    const { operator_id, service_id, sub_service_id } = req.query;

    let query = `
      SELECT 
        oa.id,
        oa.operator_id,
        oa.sub_service_id,
        oa.district,
        oa.tehsil,
        oa.ward_no,
        oa.area_label,
        oa.is_active,
        oa.custom_fee,
        oa.created_at,
        u.full_name as operatorName,
        u.mobile as operatorMobile,
        u.is_online as operatorOnline,
        ss.name as subServiceName,
        ss.code as subServiceCode,
        ss.fee as default_fee,
        COALESCE(ss.admin_commission_percentage, s.admin_commission_percentage, 0.00) as adminCommissionPercent,
        ss.service_id,
        ss.operator_assignment_mode as assignmentMode,
        s.name as serviceName,
        s.operator_assignment_mode as serviceAssignmentMode
      FROM operator_assignments oa
      JOIN users u ON oa.operator_id = u.id
      JOIN sub_services ss ON oa.sub_service_id = ss.id
      JOIN services s ON ss.service_id = s.id
      WHERE 1=1
    `;

    const params = [];

    // Filter by logged-in operator if role is operator
    let effectiveOperatorId = operator_id;
    if (!effectiveOperatorId && req.user && req.user.role === 'operator') {
      effectiveOperatorId = req.user.id;
    }

    if (effectiveOperatorId) {
      query += ' AND oa.operator_id = ?';
      params.push(effectiveOperatorId);
    }
    if (sub_service_id) {
      query += ' AND oa.sub_service_id = ?';
      params.push(sub_service_id);
    }
    if (service_id) {
      query += ' AND ss.service_id = ?';
      params.push(service_id);
    }

    query += ' ORDER BY oa.created_at DESC';

    const [rows] = await pool.query(query, params);

    const formatted = rows.map(r => {
      const commPercent = parseFloat(r.adminCommissionPercent || 0);
      const totalFee = (r.custom_fee !== null && r.custom_fee !== undefined) ? parseFloat(r.custom_fee) : parseFloat(r.default_fee || 0);
      const adminProfit = (totalFee * commPercent) / 100;
      const operatorShare = totalFee - adminProfit;

      return {
        id: r.id.toString(),
        operatorId: r.operator_id.toString(),
        operatorName: r.operatorName,
        operatorMobile: r.operatorMobile,
        operatorOnline: !!r.operatorOnline,
        subServiceId: r.sub_service_id.toString(),
        subServiceName: r.subServiceName,
        subServiceCode: r.subServiceCode,
        serviceId: r.service_id.toString(),
        serviceName: r.serviceName,
        assignmentMode: (r.area_label && r.area_label.trim()) ? 'area_wise' : (r.ward_no && String(r.ward_no).trim()) ? 'ward_wise' : (r.assignmentMode || r.serviceAssignmentMode || 'single'),
        district: r.district || 'Gwalior',
        tehsil: r.tehsil || '',
        wardNo: r.ward_no || '',
        areaLabel: r.area_label || '',
        customFee: r.custom_fee !== null && r.custom_fee !== undefined ? parseFloat(r.custom_fee) : null,
        totalFee: totalFee,
        adminCommissionPercent: commPercent,
        adminProfit: adminProfit,
        operatorShare: operatorShare,
        currentFee: operatorShare, // Net amount after admin commission cut
        isActive: !!r.is_active,
        createdAt: r.created_at
      };
    });

    return res.status(200).json({ status: 'success', data: formatted });
  } catch (error) {
    console.error('Get Assignments Error:', error);
    return res.status(500).json({ status: 'error', message: error.message });
  }
};

/**
 * 2. Create Operator Assignment
 * POST /api/operator-assignments
 * Body: { operator_id, service_id?, sub_service_id?, area_label?, ward_no? }
 *   (also accepts camelCase: operatorId, subServiceId, areaLabel, wardNo)
 */
export const createAssignment = async (req, res) => {
  try {
    const operatorId = req.body.operator_id || req.body.operatorId;
    let subServiceId = req.body.sub_service_id || req.body.subServiceId;
    const serviceId = req.body.service_id || req.body.serviceId;
    const district = req.body.district || 'Gwalior';
    let areaLabel = req.body.area_label || req.body.areaLabel || null;
    let wardNo = req.body.ward_no || req.body.wardNo || null;

    if (!operatorId) {
      return res.status(400).json({ status: 'error', message: 'Operator ID is required.' });
    }

    // Check operator exists
    const [opRows] = await pool.query(
      'SELECT id, full_name FROM users WHERE id = ? AND role = "operator"',
      [operatorId]
    );
    if (opRows.length === 0) {
      return res.status(404).json({ status: 'error', message: 'Operator not found.' });
    }
    const operatorName = opRows[0].full_name;

    // Get sub-services to assign
    let targetSubServices = [];
    let serviceName = '';
    let routingMode = 'single';

    if (serviceId) {
      const [sRows] = await pool.query('SELECT id, name, operator_assignment_mode FROM services WHERE id = ?', [serviceId]);
      if (sRows.length === 0) {
        return res.status(404).json({ status: 'error', message: 'Service not found.' });
      }
      serviceName = sRows[0].name;
      routingMode = sRows[0].operator_assignment_mode || 'single';

      let [subRows] = await pool.query('SELECT id, name FROM sub_services WHERE service_id = ?', [serviceId]);
      
      // If service has no explicit sub-services, auto-create default sub-service row so operator assignment works seamlessly
      if (subRows.length === 0) {
        const [sInfo] = await pool.query('SELECT name, code, fee, admin_commission_percentage, form_schema FROM services WHERE id = ?', [serviceId]);
        if (sInfo.length > 0) {
          const sName = sInfo[0].name;
          const code = sInfo[0].code || `SRV-${serviceId}`;
          const fee = parseFloat(sInfo[0].fee || 0);
          const comm = parseFloat(sInfo[0].admin_commission_percentage || 0);
          const schema = sInfo[0].form_schema || '[]';
          const adminProfit = (fee * comm) / 100;
          const operatorShare = fee - adminProfit;

          const [insertRes] = await pool.query(
            `INSERT INTO sub_services (service_id, name, code, fee, agent_fee, operator_share, distributor_share, admin_profit, admin_commission_percentage, form_schema, required_docs, operator_assignment_mode, created_by, is_active)
             VALUES (?, ?, ?, ?, ?, ?, 0.00, ?, ?, ?, '[]', ?, 1, true)`,
            [serviceId, sName, code, fee, fee, operatorShare, adminProfit, comm, schema, routingMode]
          );
          subRows = [{ id: insertRes.insertId, name: sName }];
        } else {
          return res.status(404).json({ status: 'error', message: 'Service not found.' });
        }
      }
      targetSubServices = subRows;
    } else if (subServiceId) {
      const [subRows] = await pool.query(
        `SELECT ss.id, ss.name, ss.service_id, s.name as service_name, s.operator_assignment_mode 
         FROM sub_services ss JOIN services s ON ss.service_id = s.id WHERE ss.id = ?`,
        [subServiceId]
      );
      if (subRows.length === 0) {
        return res.status(404).json({ status: 'error', message: 'Sub-Service not found.' });
      }
      serviceName = subRows[0].service_name;
      routingMode = subRows[0].operator_assignment_mode || 'single';
      targetSubServices = [{ id: subRows[0].id, name: subRows[0].name }];
    } else {
      return res.status(400).json({ status: 'error', message: 'Service or Sub-Service ID is required.' });
    }

    // Enforce routing mode restrictions
    if (routingMode === 'single') {
      areaLabel = null;
      wardNo = null;
      // Single mode: clear previous operator assignments for this service/sub-services
      const subIds = targetSubServices.map(s => s.id);
      if (subIds.length > 0) {
        await pool.query('DELETE FROM operator_assignments WHERE sub_service_id IN (?)', [subIds]);
      }
    } else if (routingMode === 'area_wise') {
      wardNo = null;
      if (!areaLabel || !areaLabel.trim()) {
        return res.status(400).json({ status: 'error', message: 'Office / Area Name is required for Area Wise assignment.' });
      }
      areaLabel = areaLabel.trim();
    } else if (routingMode === 'ward_wise') {
      areaLabel = null;
      if (!wardNo || isNaN(Number(wardNo))) {
        return res.status(400).json({ status: 'error', message: 'Valid Ward Number is required for Ward Wise assignment.' });
      }
      wardNo = String(wardNo);
    }

    // Create assignments for target sub-services
    let insertedCount = 0;
    for (const sub of targetSubServices) {
      const [existing] = await pool.query(
        `SELECT id FROM operator_assignments 
         WHERE operator_id = ? AND sub_service_id = ? 
           AND (area_label <=> ?) AND (ward_no <=> ?) LIMIT 1`,
        [operatorId, sub.id, areaLabel, wardNo]
      );

      if (existing.length === 0) {
        await pool.query(
          `INSERT INTO operator_assignments (operator_id, sub_service_id, district, area_label, ward_no, is_active) 
           VALUES (?, ?, ?, ?, ?, true)`,
          [operatorId, sub.id, district, areaLabel, wardNo]
        );
        insertedCount++;
      }
    }

    return res.status(201).json({
      status: 'success',
      message: `Operator "${operatorName}" successfully assigned to "${serviceName}"!`,
      data: { count: insertedCount }
    });
  } catch (error) {
    console.error('Create Assignment Error:', error);
    return res.status(500).json({ status: 'error', message: error.message });
  }
};

/**
 * 3. Delete Operator Assignment
 * DELETE /api/operator-assignments/:id
 */
export const deleteAssignment = async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query('DELETE FROM operator_assignments WHERE id = ?', [id]);
    return res.status(200).json({ status: 'success', message: 'Assignment removed successfully.' });
  } catch (error) {
    console.error('Delete Assignment Error:', error);
    return res.status(500).json({ status: 'error', message: error.message });
  }
};

/**
 * 4. Get Available Areas/Wards for a Service (Agent Smart Dropdown)
 * GET /api/operator-assignments/areas?service_id=X OR ?sub_service_id=X
 * Returns: { mode, areas: string[], wards: string[], hasOperators: boolean }
 */
export const getAvailableAreas = async (req, res) => {
  try {
    const { service_id, sub_service_id } = req.query;

    if (!service_id && !sub_service_id) {
      return res.status(400).json({ status: 'error', message: 'service_id or sub_service_id required.' });
    }

    // Determine assignment mode from the service/sub-service
    let assignmentMode = 'single';
    let targetSubServiceId = sub_service_id;

    if (sub_service_id) {
      const [ssRows] = await pool.query(
        `SELECT ss.operator_assignment_mode as sub_mode, s.operator_assignment_mode as service_mode
         FROM sub_services ss JOIN services s ON ss.service_id = s.id WHERE ss.id = ?`,
        [sub_service_id]
      );
      if (ssRows.length > 0) {
        const subMode = ssRows[0].sub_mode;
        const serviceMode = ssRows[0].service_mode;
        assignmentMode = (subMode && subMode !== 'single') ? subMode : (serviceMode || subMode || 'single');
      }
    }

    // If sub_service_id not given but service_id given, check service-level mode
    // Also find the default sub_service for direct services (services without explicit sub-services)
    if (!sub_service_id && service_id) {
      const [sRows] = await pool.query(
        'SELECT operator_assignment_mode FROM services WHERE id = ?',
        [service_id]
      );
      if (sRows.length > 0 && sRows[0].operator_assignment_mode) {
        assignmentMode = sRows[0].operator_assignment_mode;
      }
      // For direct services, find their internal sub_service
      const [subRows] = await pool.query(
        'SELECT id FROM sub_services WHERE service_id = ? LIMIT 1',
        [service_id]
      );
      if (subRows.length > 0) {
        targetSubServiceId = subRows[0].id;
      }
    }

    // Build query to get available areas/wards based on assignments with pricing
    let query = '';
    const params = [];

    if (targetSubServiceId) {
      query = `
        SELECT DISTINCT oa.area_label, oa.ward_no, oa.district, oa.custom_fee, ss.fee as default_fee
        FROM operator_assignments oa
        JOIN users u ON oa.operator_id = u.id
        JOIN sub_services ss ON oa.sub_service_id = ss.id
        WHERE oa.sub_service_id = ? AND oa.is_active = true AND u.is_active = true
        ORDER BY oa.area_label ASC, CAST(oa.ward_no AS UNSIGNED) ASC
      `;
      params.push(targetSubServiceId);
    } else if (service_id) {
      query = `
        SELECT DISTINCT oa.area_label, oa.ward_no, oa.district, oa.custom_fee, ss.fee as default_fee
        FROM operator_assignments oa
        JOIN users u ON oa.operator_id = u.id
        JOIN sub_services ss ON oa.sub_service_id = ss.id
        WHERE ss.service_id = ? AND oa.is_active = true AND u.is_active = true
        ORDER BY oa.area_label ASC, CAST(oa.ward_no AS UNSIGNED) ASC
      `;
      params.push(service_id);
    }

    let [rows] = await pool.query(query, params);

    // Fallback: If sub_service_id didn't return any assignments, check all sub_services under parent service
    if (rows.length === 0 && sub_service_id) {
      const [parentRows] = await pool.query(
        `SELECT DISTINCT oa.area_label, oa.ward_no, oa.district, oa.custom_fee, ss.fee as default_fee
         FROM operator_assignments oa
         JOIN users u ON oa.operator_id = u.id
         JOIN sub_services ss ON oa.sub_service_id = ss.id
         WHERE ss.service_id = (SELECT service_id FROM sub_services WHERE id = ?)
           AND oa.is_active = true AND u.is_active = true
         ORDER BY oa.area_label ASC, CAST(oa.ward_no AS UNSIGNED) ASC`,
        [sub_service_id]
      );
      if (parentRows.length > 0) {
        rows = parentRows;
      }
    }

    // Build separate area_label[] and ward_no[] arrays with detailed price objects
    const areaLabels = [];
    const wardNos = [];
    const areaDetails = [];
    const wardDetails = [];
    const seenAreas = new Set();
    const seenWards = new Set();
    let defaultBasePrice = 0.00;

    for (const r of rows) {
      const price = (r.custom_fee !== null && r.custom_fee !== undefined) ? parseFloat(r.custom_fee) : parseFloat(r.default_fee || 0);
      defaultBasePrice = parseFloat(r.default_fee || 0);

      if (r.area_label && !seenAreas.has(r.area_label)) {
        seenAreas.add(r.area_label);
        areaLabels.push(r.area_label);
        areaDetails.push({ label: r.area_label, price });
      }
      if (r.ward_no && !seenWards.has(r.ward_no)) {
        seenWards.add(r.ward_no);
        wardNos.push(r.ward_no);
        wardDetails.push({ wardNo: r.ward_no, label: `Gwalior Ward #${r.ward_no}`, price });
      }
    }

    // Sort wards numerically
    wardNos.sort((a, b) => parseInt(a) - parseInt(b));
    wardDetails.sort((a, b) => parseInt(a.wardNo) - parseInt(b.wardNo));

    return res.status(200).json({
      status: 'success',
      data: {
        mode: assignmentMode,
        areas: areaLabels,
        wards: wardNos,
        areaDetails,
        wardDetails,
        basePrice: defaultBasePrice,
        hasOperators: rows.length > 0
      }
    });
  } catch (error) {
    console.error('Get Available Areas Error:', error);
    return res.status(500).json({ status: 'error', message: error.message });
  }
};

/**
 * 5. Find Matching Operator for Application Assignment
 * GET /api/operator-assignments/find-operator?sub_service_id=X&area_label=Y&ward_no=Z
 * Returns the best-matched operator for the given service + area/ward
 */
export const findOperator = async (req, res) => {
  try {
    const { sub_service_id, service_id, area_label, ward_no } = req.query;

    if (!sub_service_id && !service_id) {
      return res.status(400).json({ status: 'error', message: 'sub_service_id or service_id required.' });
    }

    // Resolve sub_service_id from service_id if needed
    let targetSubServiceId = sub_service_id;
    if (!targetSubServiceId && service_id) {
      const [subRows] = await pool.query(
        'SELECT id FROM sub_services WHERE service_id = ? LIMIT 1',
        [service_id]
      );
      if (subRows.length > 0) {
        targetSubServiceId = subRows[0].id;
      }
    }

    if (!targetSubServiceId) {
      return res.status(200).json({
        status: 'success',
        data: { found: false, operatorId: null, operatorName: null }
      });
    }

    // Fetch sub-service & parent service routing mode
    const [modeRows] = await pool.query(
      `SELECT ss.operator_assignment_mode as sub_mode, s.operator_assignment_mode as service_mode
       FROM sub_services ss 
       JOIN services s ON ss.service_id = s.id 
       WHERE ss.id = ?`,
      [targetSubServiceId]
    );

    const subMode = modeRows.length > 0 ? modeRows[0].sub_mode : null;
    const serviceMode = modeRows.length > 0 ? modeRows[0].service_mode : null;
    const routingMode = (subMode && subMode !== 'single') ? subMode : (serviceMode || subMode || 'single');

    let query = '';
    const params = [];

    if (routingMode === 'ward_wise' && ward_no) {
      query = `
        SELECT oa.operator_id, u.full_name as operatorName, u.is_online
        FROM operator_assignments oa
        JOIN users u ON oa.operator_id = u.id
        WHERE oa.sub_service_id = ? AND oa.ward_no = ? AND oa.is_active = true AND u.is_active = true
        LIMIT 1
      `;
      params.push(targetSubServiceId, ward_no);
    } else if (routingMode === 'area_wise' && area_label) {
      query = `
        SELECT oa.operator_id, u.full_name as operatorName, u.is_online
        FROM operator_assignments oa
        JOIN users u ON oa.operator_id = u.id
        WHERE oa.sub_service_id = ? AND oa.area_label = ? AND oa.is_active = true AND u.is_active = true
        LIMIT 1
      `;
      params.push(targetSubServiceId, area_label);
    } else {
      // Single mode or fallback: match any active assignment for this sub-service
      query = `
        SELECT oa.operator_id, u.full_name as operatorName, u.is_online
        FROM operator_assignments oa
        JOIN users u ON oa.operator_id = u.id
        WHERE oa.sub_service_id = ? AND oa.is_active = true AND u.is_active = true
        LIMIT 1
      `;
      params.push(targetSubServiceId);
    }

    const [rows] = await pool.query(query, params);

    if (rows.length === 0) {
      return res.status(200).json({
        status: 'success',
        data: { found: false, operatorId: null, operatorName: null }
      });
    }

    return res.status(200).json({
      status: 'success',
      data: {
        found: true,
        operatorId: rows[0].operator_id.toString(),
        operatorName: rows[0].operatorName,
        isOnline: !!rows[0].is_online
      }
    });
  } catch (error) {
    console.error('Find Operator Error:', error);
    return res.status(500).json({ status: 'error', message: error.message });
  }
};
