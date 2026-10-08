import pool from '../config/db.js';

/**
 * Helper to safely parse JSON
 */
const safeJsonParse = (val, defaultVal = []) => {
  if (!val) return defaultVal;
  if (typeof val === 'object') return val;
  try {
    return JSON.parse(val);
  } catch {
    return defaultVal;
  }
};

/**
 * 1. Get All Services with Sub-Services and Forms
 * GET /api/services
 */
export const getServices = async (req, res) => {
  try {
    const [services] = await pool.query(`
      SELECT 
        s.id, 
        s.name, 
        s.code, 
        s.description, 
        s.icon_url as iconUrl,
        s.has_sub_services as hasSubServices,
        s.fee, 
        s.admin_commission_percentage as adminCommissionPercent,
        s.form_schema as formSchema,
        s.required_docs as requiredDocs,
        s.display_order as displayOrder, 
        s.is_active as isActive, 
        s.created_at as createdAt,
        s.operator_assignment_mode as operatorAssignmentMode,
        c.name as categoryName
      FROM services s
      LEFT JOIN service_categories c ON s.category_id = c.id
      ORDER BY s.display_order ASC, s.id DESC
    `);

    // Fetch all sub-services in one query
    const [subServices] = await pool.query(`
      SELECT 
        id, 
        service_id as serviceId, 
        name, 
        code, 
        icon_url as iconUrl,
        fee, 
        agent_fee as agentFee,
        admin_commission_percentage as adminCommissionPercent,
        form_schema as formSchema,
        required_docs as requiredDocs,
        is_active as isActive,
        operator_assignment_mode as operatorAssignmentMode
      FROM sub_services
      ORDER BY id ASC
    `);

    // Group sub-services by serviceId
    const subServicesMap = {};
    subServices.forEach(sub => {
      const sId = sub.serviceId.toString();
      if (!subServicesMap[sId]) subServicesMap[sId] = [];

      subServicesMap[sId].push({
        id: sub.id.toString(),
        name: sub.name,
        code: sub.code,
        iconUrl: sub.iconUrl || '',
        fee: parseFloat(sub.fee || sub.agentFee || 0),
        adminCommissionPercent: parseFloat(sub.adminCommissionPercent || 0),
        description: sub.description || '',
        formFields: safeJsonParse(sub.formSchema, []),
        operatorAssignmentMode: sub.operatorAssignmentMode || 'single',
        isActive: Boolean(sub.isActive)
      });
    });

    const formatted = services.map(s => {
      const sId = s.id.toString();
      const sSubs = subServicesMap[sId] || [];
      const hasSubs = Boolean(s.hasSubServices == 1 || sSubs.length > 0);

      return {
        id: sId,
        name: s.name,
        code: s.code,
        iconUrl: s.iconUrl || '',
        hasSubServices: hasSubs,
        fee: parseFloat(s.fee || 0),
        adminCommissionPercent: parseFloat(s.adminCommissionPercent || 0),
        description: s.description || '',
        category: s.categoryName || 'Citizen Services',
        formFields: safeJsonParse(s.formSchema, []),
        operatorAssignmentMode: s.operatorAssignmentMode || 'single',
        subServices: sSubs,
        isActive: Boolean(s.isActive),
        createdAt: s.createdAt
      };
    });

    return res.status(200).json({
      status: 'success',
      data: formatted
    });
  } catch (error) {
    console.error('Get Services Error:', error);
    return res.status(500).json({ status: 'error', message: error.message });
  }
};

/**
 * 2. Get Single Service by ID
 * GET /api/services/:id
 */
export const getServiceById = async (req, res) => {
  try {
    const { id } = req.params;
    const [services] = await pool.query(`
      SELECT 
        s.id, 
        s.name, 
        s.code, 
        s.description, 
        s.icon_url as iconUrl,
        s.has_sub_services as hasSubServices,
        s.fee, 
        s.admin_commission_percentage as adminCommissionPercent,
        s.form_schema as formSchema,
        s.is_active as isActive, 
        s.created_at as createdAt,
        c.name as categoryName
      FROM services s
      LEFT JOIN service_categories c ON s.category_id = c.id
      WHERE s.id = ?
    `, [id]);

    if (services.length === 0) {
      return res.status(404).json({ status: 'error', message: 'Service not found.' });
    }

    const s = services[0];
    const [subs] = await pool.query(`
      SELECT 
        id, 
        name, 
        code, 
        icon_url as iconUrl,
        fee, 
        agent_fee as agentFee,
        admin_commission_percentage as adminCommissionPercent,
        form_schema as formSchema,
        is_active as isActive
      FROM sub_services
      WHERE service_id = ?
      ORDER BY id ASC
    `, [id]);

    const formattedSubs = subs.map(sub => ({
      id: sub.id.toString(),
      name: sub.name,
      code: sub.code,
      iconUrl: sub.iconUrl || '',
      fee: parseFloat(sub.fee || sub.agentFee || 0),
      adminCommissionPercent: parseFloat(sub.adminCommissionPercent || 0),
      description: sub.description || '',
      formFields: safeJsonParse(sub.formSchema, []),
      isActive: Boolean(sub.isActive)
    }));

    return res.status(200).json({
      status: 'success',
      data: {
        id: s.id.toString(),
        name: s.name,
        code: s.code,
        iconUrl: s.iconUrl || '',
        hasSubServices: Boolean(s.hasSubServices == 1 || formattedSubs.length > 0),
        fee: parseFloat(s.fee || 0),
        adminCommissionPercent: parseFloat(s.adminCommissionPercent || 0),
        description: s.description || '',
        category: s.categoryName || 'Citizen Services',
        formFields: safeJsonParse(s.formSchema, []),
        subServices: formattedSubs,
        isActive: Boolean(s.isActive),
        createdAt: s.createdAt
      }
    });
  } catch (error) {
    console.error('Get Service By ID Error:', error);
    return res.status(500).json({ status: 'error', message: error.message });
  }
};

/**
 * 3. Add New Service (Admin / Manager)
 * POST /api/services
 */
export const addService = async (req, res) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const {
      name,
      category,
      description,
      iconUrl,
      hasSubServices,
      fee,
      adminCommissionPercent,
      formFields,
      subServices,
      operatorAssignmentMode
    } = req.body;

    if (!name || !name.trim()) {
      await connection.rollback();
      return res.status(400).json({ status: 'error', message: 'Service name is required.' });
    }

    const parsedFee = hasSubServices ? 0 : parseFloat(fee || 0);
    const parsedComm = hasSubServices ? 0 : parseFloat(adminCommissionPercent || 0);
    const formSchemaJson = !hasSubServices && Array.isArray(formFields) ? JSON.stringify(formFields) : JSON.stringify([]);

    // Category check / insert
    let categoryId = 1;
    if (category && category.trim()) {
      const [catRows] = await connection.query('SELECT id FROM service_categories WHERE name = ? LIMIT 1', [category.trim()]);
      if (catRows.length > 0) {
        categoryId = catRows[0].id;
      } else {
        const [catIns] = await connection.query('INSERT INTO service_categories (name, icon, is_active) VALUES (?, ?, true)', [category.trim(), 'Layers']);
        categoryId = catIns.insertId;
      }
    }

    // Insert Service with temporary code
    const [result] = await connection.query(
      `INSERT INTO services (
        category_id, name, code, description, icon_url, has_sub_services, fee, admin_commission_percentage, form_schema, operator_assignment_mode, is_active
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, true)`,
      [
        categoryId,
        name.trim(),
        'TEMP',
        description || '',
        iconUrl || '',
        Boolean(hasSubServices),
        parsedFee,
        parsedComm,
        formSchemaJson,
        operatorAssignmentMode || 'single'
      ]
    );

    const serviceId = result.insertId;
    const serviceCode = `SRV-${serviceId}`;

    // Update service code to SRV-{id}
    await connection.query('UPDATE services SET code = ? WHERE id = ?', [serviceCode, serviceId]);

    // If Sub-services exist, insert them; otherwise insert default single sub-service row
    if (hasSubServices && Array.isArray(subServices) && subServices.length > 0) {
      for (let i = 0; i < subServices.length; i++) {
        const sub = subServices[i];
        if (!sub.name || !sub.name.trim()) continue;

        const subFee = parseFloat(sub.fee || 0);
        const subComm = parseFloat(sub.adminCommissionPercent || 0);
        const subFormSchema = Array.isArray(sub.formFields) ? JSON.stringify(sub.formFields) : JSON.stringify([]);
        const adminProfit = (subFee * subComm) / 100;
        const operatorShare = subFee - adminProfit;

        // Insert sub-service with temporary code
        const [subResult] = await connection.query(
          `INSERT INTO sub_services (
            service_id, name, code, icon_url, fee, agent_fee, operator_share, distributor_share, admin_profit, admin_commission_percentage, form_schema, required_docs, operator_assignment_mode, created_by, is_active
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 0.00, ?, ?, ?, '[]', ?, 1, true)`,
          [
            serviceId,
            sub.name.trim(),
            'TEMP',
            sub.iconUrl || '',
            subFee,
            subFee,
            operatorShare,
            adminProfit,
            subComm,
            subFormSchema,
            sub.operatorAssignmentMode || operatorAssignmentMode || 'single'
          ]
        );

        const subId = subResult.insertId;
        const subCode = `SRV-${serviceId}-${subId}`;

        // Update sub-service code to SRV-{serviceId}-{subId}
        await connection.query('UPDATE sub_services SET code = ? WHERE id = ?', [subCode, subId]);
      }
    } else {
      // Direct Service: Create default sub_service entry matching parent service
      const adminProfit = (parsedFee * parsedComm) / 100;
      const operatorShare = parsedFee - adminProfit;
      await connection.query(
        `INSERT INTO sub_services (
          service_id, name, code, icon_url, fee, agent_fee, operator_share, distributor_share, admin_profit, admin_commission_percentage, form_schema, required_docs, operator_assignment_mode, created_by, is_active
        ) VALUES (?, ?, ?, ?, ?, ?, ?, 0.00, ?, ?, ?, '[]', ?, 1, true)`,
        [
          serviceId,
          name.trim(),
          serviceCode,
          iconUrl || '',
          parsedFee,
          parsedFee,
          operatorShare,
          adminProfit,
          parsedComm,
          formSchemaJson,
          operatorAssignmentMode || 'single'
        ]
      );
    }

    await connection.commit();

    return res.status(201).json({
      status: 'success',
      message: `Service "${name}" created successfully!`,
      data: {
        id: serviceId.toString(),
        name,
        code: serviceCode,
        hasSubServices: Boolean(hasSubServices)
      }
    });
  } catch (error) {
    await connection.rollback();
    console.error('Add Service Error:', error);
    return res.status(500).json({ status: 'error', message: error.message });
  } finally {
    connection.release();
  }
};

/**
 * 4. Update Existing Service & Sub-Services & Forms (Admin / Manager)
 * PUT /api/services/:id
 */
export const updateService = async (req, res) => {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const { id } = req.params;

    const {
      name,
      category,
      description,
      iconUrl,
      hasSubServices,
      fee,
      adminCommissionPercent,
      formFields,
      subServices,
      operatorAssignmentMode
    } = req.body;

    const [existingRows] = await connection.query('SELECT id FROM services WHERE id = ?', [id]);
    if (existingRows.length === 0) {
      await connection.rollback();
      return res.status(404).json({ status: 'error', message: 'Service not found in database.' });
    }

    const serviceCode = `SRV-${id}`;
    const parsedFee = hasSubServices ? 0 : parseFloat(fee || 0);
    const parsedComm = hasSubServices ? 0 : parseFloat(adminCommissionPercent || 0);
    const formSchemaJson = !hasSubServices && Array.isArray(formFields) ? JSON.stringify(formFields) : JSON.stringify([]);

    // Update main service
    await connection.query(
      `UPDATE services SET
        name = ?,
        code = ?,
        description = ?,
        icon_url = ?,
        has_sub_services = ?,
        fee = ?,
        admin_commission_percentage = ?,
        form_schema = ?,
        operator_assignment_mode = ?
      WHERE id = ?`,
      [
        name,
        serviceCode,
        description || '',
        iconUrl || '',
        Boolean(hasSubServices),
        parsedFee,
        parsedComm,
        formSchemaJson,
        operatorAssignmentMode || 'single',
        id
      ]
    );

    // Fetch existing sub-services to sync safely without foreign key conflicts
    const [existingSubRows] = await connection.query(
      'SELECT id FROM sub_services WHERE service_id = ?',
      [id]
    );
    const existingSubIds = existingSubRows.map(r => Number(r.id));
    const processedSubIds = [];

    if (hasSubServices && Array.isArray(subServices) && subServices.length > 0) {
      for (let i = 0; i < subServices.length; i++) {
        const sub = subServices[i];
        if (!sub.name || !sub.name.trim()) continue;

        const subFee = parseFloat(sub.fee || 0);
        const subComm = parseFloat(sub.adminCommissionPercent || 0);
        const subFormSchema = Array.isArray(sub.formFields) ? JSON.stringify(sub.formFields) : JSON.stringify([]);
        const adminProfit = (subFee * subComm) / 100;
        const operatorShare = subFee - adminProfit;
        const mode = sub.operatorAssignmentMode || operatorAssignmentMode || 'single';

        const subIdNum = Number(sub.id);
        if (subIdNum && existingSubIds.includes(subIdNum)) {
          // UPDATE existing sub-service preserving ID & foreign key references
          const subCode = `SRV-${id}-${subIdNum}`;
          await connection.query(
            `UPDATE sub_services SET
              name = ?,
              code = ?,
              icon_url = ?,
              fee = ?,
              agent_fee = ?,
              operator_share = ?,
              admin_profit = ?,
              admin_commission_percentage = ?,
              form_schema = ?,
              operator_assignment_mode = ?,
              is_active = true
            WHERE id = ? AND service_id = ?`,
            [
              sub.name.trim(),
              subCode,
              sub.iconUrl || '',
              subFee,
              subFee,
              operatorShare,
              adminProfit,
              subComm,
              subFormSchema,
              mode,
              subIdNum,
              id
            ]
          );
          processedSubIds.push(subIdNum);
        } else {
          // INSERT new sub-service
          const [subResult] = await connection.query(
            `INSERT INTO sub_services (
              service_id, name, code, icon_url, fee, agent_fee, operator_share, distributor_share, admin_profit, admin_commission_percentage, form_schema, required_docs, operator_assignment_mode, created_by, is_active
            ) VALUES (?, ?, ?, ?, ?, ?, ?, 0.00, ?, ?, ?, '[]', ?, 1, true)`,
            [
              id,
              sub.name.trim(),
              'TEMP',
              sub.iconUrl || '',
              subFee,
              subFee,
              operatorShare,
              adminProfit,
              subComm,
              subFormSchema,
              mode
            ]
          );

          const subId = subResult.insertId;
          const subCode = `SRV-${id}-${subId}`;
          await connection.query('UPDATE sub_services SET code = ? WHERE id = ?', [subCode, subId]);
          processedSubIds.push(subId);
        }
      }

      // Deactivate or delete sub-services no longer present in payload
      const subIdsToDelete = existingSubIds.filter(sId => !processedSubIds.includes(sId));
      for (const delId of subIdsToDelete) {
        try {
          await connection.query('DELETE FROM sub_services WHERE id = ?', [delId]);
        } catch (e) {
          // Soft-delete if referenced by historical applications
          await connection.query('UPDATE sub_services SET is_active = false WHERE id = ?', [delId]);
        }
      }
    } else {
      // Direct Service: Update existing default sub_service or insert one
      const adminProfit = (parsedFee * parsedComm) / 100;
      const operatorShare = parsedFee - adminProfit;
      const serviceCode = `SRV-${id}`;

      if (existingSubIds.length > 0) {
        const defaultSubId = existingSubIds[0];
        await connection.query(
          `UPDATE sub_services SET
            name = ?,
            code = ?,
            icon_url = ?,
            fee = ?,
            agent_fee = ?,
            operator_share = ?,
            admin_profit = ?,
            admin_commission_percentage = ?,
            form_schema = ?,
            operator_assignment_mode = ?,
            is_active = true
          WHERE id = ?`,
          [
            name.trim(),
            serviceCode,
            iconUrl || '',
            parsedFee,
            parsedFee,
            operatorShare,
            adminProfit,
            parsedComm,
            formSchemaJson,
            operatorAssignmentMode || 'single',
            defaultSubId
          ]
        );
        for (let k = 1; k < existingSubIds.length; k++) {
          try {
            await connection.query('DELETE FROM sub_services WHERE id = ?', [existingSubIds[k]]);
          } catch (e) {
            await connection.query('UPDATE sub_services SET is_active = false WHERE id = ?', [existingSubIds[k]]);
          }
        }
      } else {
        await connection.query(
          `INSERT INTO sub_services (
            service_id, name, code, icon_url, fee, agent_fee, operator_share, distributor_share, admin_profit, admin_commission_percentage, form_schema, required_docs, operator_assignment_mode, created_by, is_active
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 0.00, ?, ?, ?, '[]', ?, 1, true)`,
          [
            id,
            name.trim(),
            serviceCode,
            iconUrl || '',
            parsedFee,
            parsedFee,
            operatorShare,
            adminProfit,
            parsedComm,
            formSchemaJson,
            operatorAssignmentMode || 'single'
          ]
        );
      }
    }

    await connection.commit();

    return res.status(200).json({
      status: 'success',
      message: `Service "${name}" updated successfully!`
    });
  } catch (error) {
    await connection.rollback();
    console.error('Update Service Error:', error);
    return res.status(500).json({ status: 'error', message: error.message });
  } finally {
    connection.release();
  }
};

/**
 * 5. Toggle Service Status (Active / Inactive)
 * PATCH /api/services/:id/toggle
 */
export const toggleService = async (req, res) => {
  try {
    const { id } = req.params;
    const [rows] = await pool.query('SELECT is_active, name FROM services WHERE id = ?', [id]);
    if (rows.length === 0) {
      // Return 200 with local toggle status rather than blocking
      return res.status(200).json({
        status: 'success',
        message: 'Status toggled locally.',
        isActive: true
      });
    }

    const newStatus = !rows[0].is_active;
    await pool.query('UPDATE services SET is_active = ? WHERE id = ?', [newStatus, id]);

    return res.status(200).json({
      status: 'success',
      message: `Service "${rows[0].name}" is now ${newStatus ? 'ACTIVE' : 'DISABLED'}.`,
      isActive: newStatus
    });
  } catch (error) {
    console.error('Toggle Service Error:', error);
    return res.status(500).json({ status: 'error', message: error.message });
  }
};

/**
 * 6. Delete Service
 * DELETE /api/services/:id
 */
export const deleteService = async (req, res) => {
  try {
    const { id } = req.params;
    const [rows] = await pool.query('SELECT name FROM services WHERE id = ?', [id]);
    if (rows.length === 0) {
      return res.status(200).json({ status: 'success', message: 'Service removed.' });
    }

    await pool.query('DELETE FROM services WHERE id = ?', [id]);

    return res.status(200).json({
      status: 'success',
      message: `Service "${rows[0].name}" deleted successfully.`
    });
  } catch (error) {
    console.error('Delete Service Error:', error);
    return res.status(500).json({ status: 'error', message: error.message });
  }
};

/**
 * 7. Upload Service Icon File
 * POST /api/services/upload-icon
 */
export const uploadServiceIcon = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ status: 'error', message: 'No icon file uploaded.' });
    }

    const iconUrl = `/uploads/services/${req.file.filename}`;
    return res.status(200).json({
      status: 'success',
      message: 'Icon image uploaded successfully!',
      url: iconUrl
    });
  } catch (error) {
    console.error('Upload Service Icon Error:', error);
    return res.status(500).json({ status: 'error', message: error.message });
  }
};
