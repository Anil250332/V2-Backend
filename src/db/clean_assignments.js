import pool from '../config/db.js';

async function clean() {
  try {
    // 1. Delete assignments for test operator (id 8)
    await pool.query('DELETE FROM operator_assignments WHERE operator_id = 8');

    // 2. Fix area_wise services: set ward_no = NULL
    await pool.query(`
      UPDATE operator_assignments oa
      JOIN sub_services ss ON oa.sub_service_id = ss.id
      JOIN services s ON ss.service_id = s.id
      SET oa.ward_no = NULL
      WHERE s.operator_assignment_mode = 'area_wise'
    `);

    // 3. Fix single services: set area_label = NULL, ward_no = NULL
    await pool.query(`
      UPDATE operator_assignments oa
      JOIN sub_services ss ON oa.sub_service_id = ss.id
      JOIN services s ON ss.service_id = s.id
      SET oa.area_label = NULL, oa.ward_no = NULL
      WHERE s.operator_assignment_mode = 'single'
    `);

    // 4. Delete empty area_label / ward_no assignments for area_wise / ward_wise services
    await pool.query(`
      DELETE oa FROM operator_assignments oa
      JOIN sub_services ss ON oa.sub_service_id = ss.id
      JOIN services s ON ss.service_id = s.id
      WHERE (s.operator_assignment_mode = 'area_wise' AND (oa.area_label IS NULL OR TRIM(oa.area_label) = ''))
         OR (s.operator_assignment_mode = 'ward_wise' AND (oa.ward_no IS NULL OR TRIM(oa.ward_no) = ''))
    `);

    // 4. For single mode services, keep only 1 operator per service
    const [singleSubs] = await pool.query(`
      SELECT oa.sub_service_id, MIN(oa.id) as keep_id
      FROM operator_assignments oa
      JOIN sub_services ss ON oa.sub_service_id = ss.id
      JOIN services s ON ss.service_id = s.id
      WHERE s.operator_assignment_mode = 'single'
      GROUP BY oa.sub_service_id
    `);

    for (const sub of singleSubs) {
      await pool.query('DELETE FROM operator_assignments WHERE sub_service_id = ? AND id != ?', [sub.sub_service_id, sub.keep_id]);
    }

    const [rows] = await pool.query(`
      SELECT oa.id, oa.area_label, oa.ward_no, s.name as service_name, s.operator_assignment_mode as s_mode, u.full_name as op_name 
      FROM operator_assignments oa 
      JOIN sub_services ss ON oa.sub_service_id = ss.id 
      JOIN services s ON ss.service_id = s.id 
      JOIN users u ON oa.operator_id = u.id
    `);

    console.log('Cleaned DB rows:', JSON.stringify(rows, null, 2));
  } catch (err) {
    console.error('Clean error:', err);
  } finally {
    process.exit(0);
  }
}

clean();
