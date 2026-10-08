/**
 * ============================================================
 *  DB RESET & SEED SCRIPT — v2online_portal
 *  Clears ALL data from all tables, keeps 1 user per panel,
 *  creates 2 services, adds operators with assignments.
 *  
 *  Run:  node src/db/seed-reset.js
 * ============================================================
 */
import mysql from 'mysql2/promise';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import dotenv from 'dotenv';

dotenv.config();

const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '3306', 10),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'v2online_portal',
  multipleStatements: true
};

async function main() {
  const conn = await mysql.createConnection(dbConfig);
  console.log('🔌 Connected to MySQL...\n');

  // ============================================================
  // STEP 1: DISABLE FK CHECKS & TRUNCATE ALL DATA TABLES
  // ============================================================
  console.log('🗑️  Clearing ALL data from all tables...');

  await conn.query('SET FOREIGN_KEY_CHECKS = 0;');

  const tablesToClear = [
    'application_documents',
    'applications',
    'complaints',
    'operator_assignments',
    'sub_services',
    'services',
    'service_categories',
    'transactions',
    'withdrawal_requests',
    'user_requests',
    'shops',
    'wallets',
    'users'
  ];

  for (const table of tablesToClear) {
    try {
      await conn.query(`TRUNCATE TABLE \`${table}\``);
      console.log(`   ✅ Truncated: ${table}`);
    } catch (e) {
      console.log(`   ⚠️  Skip/Error on ${table}: ${e.message}`);
    }
  }

  await conn.query('SET FOREIGN_KEY_CHECKS = 1;');
  console.log('');

  // ============================================================
  // STEP 2: SEED 1 USER PER PANEL (5 panels)
  // ============================================================
  console.log('👤 Creating 1 user per panel...');

  const passwordHash = await bcrypt.hash('Test@1234', 10);

  // 2a. Super Admin
  const adminUuid = crypto.randomUUID();
  const [adminRes] = await conn.query(
    `INSERT INTO users (uuid, role, full_name, mobile, email, password_hash, district, approval_status, is_active)
     VALUES (?, 'super_admin', 'Admin Gwalior', '9999900001', 'admin@mponline.in', ?, 'Gwalior', 'approved', true)`,
    [adminUuid, passwordHash]
  );
  const adminId = adminRes.insertId;
  await conn.query('INSERT INTO wallets (user_id, balance) VALUES (?, 0.00)', [adminId]);
  console.log(`   👑 Super Admin  — Mobile: 9999900001 | Pass: Test@1234`);

  // 2b. Manager
  const mgrUuid = crypto.randomUUID();
  const [mgrRes] = await conn.query(
    `INSERT INTO users (uuid, role, full_name, mobile, email, password_hash, district, approval_status, is_active)
     VALUES (?, 'manager', 'Sanjay Manager', '9999900002', 'manager@mponline.in', ?, 'Gwalior', 'approved', true)`,
    [mgrUuid, passwordHash]
  );
  const mgrId = mgrRes.insertId;
  await conn.query('INSERT INTO wallets (user_id, balance) VALUES (?, 5000.00)', [mgrId]);
  console.log(`   💼 Manager      — Mobile: 9999900002 | Pass: Test@1234`);

  // 2c. Distributor
  const distUuid = crypto.randomUUID();
  const [distRes] = await conn.query(
    `INSERT INTO users (uuid, role, full_name, mobile, email, password_hash, district, tehsil, approval_status, is_active)
     VALUES (?, 'distributor', 'Ramesh Distributor', '9999900003', 'dist@mponline.in', ?, 'Gwalior', 'Lashkar', 'approved', true)`,
    [distUuid, passwordHash]
  );
  const distId = distRes.insertId;
  await conn.query('INSERT INTO wallets (user_id, balance) VALUES (?, 10000.00)', [distId]);
  console.log(`   🏬 Distributor  — Mobile: 9999900003 | Pass: Test@1234`);

  // 2d. Agent (Shop Owner)
  const agentUuid = crypto.randomUUID();
  const [agentRes] = await conn.query(
    `INSERT INTO users (uuid, role, full_name, mobile, email, password_hash, shop_name, aadhaar_number, address, district, tehsil, ward_no, distributor_id, approval_status, is_active)
     VALUES (?, 'agent', 'Vikram Agent', '9999900004', 'agent@mponline.in', ?, 'Vikram MP Online Center', '1234-5678-9012', 'Main Road, Lashkar, Gwalior', 'Gwalior', 'Lashkar', '12', ?, 'approved', true)`,
    [agentUuid, passwordHash, distId]
  );
  const agentId = agentRes.insertId;
  await conn.query('INSERT INTO wallets (user_id, balance) VALUES (?, 2500.00)', [agentId]);

  // Create shop record for agent
  const shopCode = `SHOP-2026-${1000 + agentId}`;
  await conn.query(
    `INSERT INTO shops (shop_id_code, user_id, owner_name, shop_name, mobile, email, aadhaar_number, full_address, district, tehsil, ward_no, distributor_id, status)
     VALUES (?, ?, 'Vikram Agent', 'Vikram MP Online Center', '9999900004', 'agent@mponline.in', '1234-5678-9012', 'Main Road, Lashkar, Gwalior', 'Gwalior', 'Lashkar', '12', ?, 'active')`,
    [shopCode, agentId, distId]
  );
  console.log(`   🛍️  Agent (Shop) — Mobile: 9999900004 | Pass: Test@1234 | Shop: ${shopCode}`);

  // 2e. Operator (we'll create 3 operators for testing)
  const operatorIds = [];
  const operatorNames = [
    { name: 'Amit Operator', mobile: '9999900005', office: 'Main Office Gwalior', ward: null, area: 'Gwalior' },
    { name: 'Suresh Operator', mobile: '9999900006', office: 'Morar Branch Office', ward: '7', area: 'Morar' },
    { name: 'Deepak Operator', mobile: '9999900007', office: 'Thatipur Center', ward: '14', area: 'Thatipur' }
  ];

  for (const op of operatorNames) {
    const opUuid = crypto.randomUUID();
    const [opRes] = await conn.query(
      `INSERT INTO users (uuid, role, full_name, mobile, email, password_hash, district, tehsil, ward_no, address, approval_status, is_active)
       VALUES (?, 'operator', ?, ?, ?, ?, 'Gwalior', 'Lashkar', ?, ?, 'approved', true)`,
      [opUuid, op.name, op.mobile, `${op.name.split(' ')[0].toLowerCase()}@mponline.in`, passwordHash, op.ward, op.office]
    );
    const opId = opRes.insertId;
    operatorIds.push(opId);
    await conn.query('INSERT INTO wallets (user_id, balance) VALUES (?, 0.00)', [opId]);
    console.log(`   👨‍💻 Operator     — ${op.name} | Mobile: ${op.mobile} | Pass: Test@1234`);
  }

  console.log('');

  // ============================================================
  // STEP 3: CREATE SERVICE CATEGORY
  // ============================================================
  console.log('📂 Creating service category...');
  const [catRes] = await conn.query(
    `INSERT INTO service_categories (name, icon, display_order, is_active) 
     VALUES ('Citizen Services', 'FileText', 1, true)`
  );
  const categoryId = catRes.insertId;
  console.log(`   ✅ Category: "Citizen Services" (ID: ${categoryId})\n`);

  // ============================================================
  // STEP 4: CREATE SERVICE #1 — Direct Service (Aadhaar Update)
  //         operator_assignment_mode = 'single' (1 operator for all Gwalior)
  // ============================================================
  console.log('📋 Creating Service #1: Aadhaar Card Update (Direct, Single Mode)...');

  const [svc1Res] = await conn.query(
    `INSERT INTO services (category_id, name, code, description, display_order, is_active, icon_url, has_sub_services, fee, admin_commission_percentage, form_schema, operator_assignment_mode)
     VALUES (?, 'Aadhaar Card Update Service', 'AADHAAR-UPD-001', 'Aadhaar card name, address & mobile update service', 1, true, NULL, false, 150.00, 20.00, ?, 'single')`,
    [categoryId, JSON.stringify([
      { id: 'f1', type: 'text', label: 'Applicant Full Name', placeholder: 'Enter your full name', required: true, docUploader: 'shop' },
      { id: 'f2', type: 'number', label: 'Aadhaar Number (12 digits)', placeholder: '123456789012', required: true, docUploader: 'shop' },
      { id: 'f3', type: 'text', label: 'Father / Husband Name', placeholder: 'Enter father or husband name', required: true, docUploader: 'shop' },
      { id: 'f4', type: 'select', label: 'Update Type', placeholder: 'Select update type', required: true, docUploader: 'shop', presetType: 'custom', options: ['Name Correction', 'Address Change', 'Mobile Update', 'DOB Correction', 'Photo Update'] },
      { id: 'f5', type: 'text', label: 'New Value (जो update करना है)', placeholder: 'Type the new corrected value...', required: true, docUploader: 'shop' },
      { id: 'f6', type: 'file', label: 'Aadhaar Card Front Photo', placeholder: '', required: true, docUploader: 'shop' },
      { id: 'f7', type: 'file', label: 'Supporting Document', placeholder: '', required: true, docUploader: 'shop' },
      { id: 'f8', type: 'file', label: 'Updated Aadhaar Card (Result)', placeholder: '', required: false, docUploader: 'operator' }
    ])]
  );
  const service1Id = svc1Res.insertId;

  // Create a corresponding sub_service entry for operator_assignments compatibility
  const [ss1Res] = await conn.query(
    `INSERT INTO sub_services (service_id, name, code, agent_fee, operator_share, admin_profit, form_schema, required_docs, is_active, created_by, operator_assignment_mode)
     VALUES (?, 'Aadhaar Card Update Service', 'AADHAAR-UPD-001-SUB', 150.00, 120.00, 30.00, '[]', '[]', true, ?, 'single')`,
    [service1Id, adminId]
  );
  const subService1Id = ss1Res.insertId;
  console.log(`   ✅ Service #1 created (ID: ${service1Id}) — Mode: SINGLE`);
  console.log(`      └─ Internal Sub-Service (ID: ${subService1Id}) for assignment mapping\n`);

  // ============================================================
  // STEP 5: CREATE SERVICE #2 — With Sub-Services (Pan Card)
  //         operator_assignment_mode = 'area_wise' (multiple offices in Gwalior)
  // ============================================================
  console.log('📋 Creating Service #2: PAN Card Services (Sub-Services, Area-Wise Mode)...');

  const [svc2Res] = await conn.query(
    `INSERT INTO services (category_id, name, code, description, display_order, is_active, icon_url, has_sub_services, fee, admin_commission_percentage, form_schema, operator_assignment_mode)
     VALUES (?, 'PAN Card Services', 'PAN-SVC-001', 'New PAN Card, PAN Correction, PAN Reprint', 2, true, NULL, true, 0.00, 0.00, NULL, 'area_wise')`,
    [categoryId]
  );
  const service2Id = svc2Res.insertId;

  // Sub-Service 2a: New PAN Card (area_wise)
  const [ss2aRes] = await conn.query(
    `INSERT INTO sub_services (service_id, name, code, agent_fee, operator_share, admin_profit, form_schema, required_docs, is_active, created_by, fee, admin_commission_percentage, operator_assignment_mode)
     VALUES (?, 'New PAN Card (Form 49A)', 'PAN-NEW-001', 250.00, 200.00, 50.00, ?, '[]', true, ?, 250.00, 20.00, 'area_wise')`,
    [service2Id, JSON.stringify([
      { id: 'p1', type: 'text', label: 'Applicant Full Name', placeholder: 'Enter applicant name', required: true, docUploader: 'shop' },
      { id: 'p2', type: 'text', label: 'Father Name', placeholder: 'Enter father name', required: true, docUploader: 'shop' },
      { id: 'p3', type: 'date', label: 'Date of Birth', placeholder: '', required: true, docUploader: 'shop' },
      { id: 'p4', type: 'text', label: 'Mobile Number', placeholder: '10 digit mobile', required: true, docUploader: 'shop' },
      { id: 'p5', type: 'text', label: 'Email Address', placeholder: 'email@example.com', required: false, docUploader: 'shop' },
      { id: 'p6', type: 'file', label: 'Aadhaar Card Copy', placeholder: '', required: true, docUploader: 'shop' },
      { id: 'p7', type: 'file', label: 'Passport Size Photo', placeholder: '', required: true, docUploader: 'shop' },
      { id: 'p8', type: 'file', label: 'PAN Card (Result PDF)', placeholder: '', required: false, docUploader: 'operator' }
    ]), adminId]
  );
  const subService2aId = ss2aRes.insertId;

  // Sub-Service 2b: PAN Correction (ward_wise)
  const [ss2bRes] = await conn.query(
    `INSERT INTO sub_services (service_id, name, code, agent_fee, operator_share, admin_profit, form_schema, required_docs, is_active, created_by, fee, admin_commission_percentage, operator_assignment_mode)
     VALUES (?, 'PAN Card Correction', 'PAN-CORR-001', 200.00, 160.00, 40.00, ?, '[]', true, ?, 200.00, 20.00, 'ward_wise')`,
    [service2Id, JSON.stringify([
      { id: 'c1', type: 'text', label: 'Current PAN Number', placeholder: 'ABCDE1234F', required: true, docUploader: 'shop' },
      { id: 'c2', type: 'text', label: 'Applicant Name (as on PAN)', placeholder: 'Current name on PAN', required: true, docUploader: 'shop' },
      { id: 'c3', type: 'select', label: 'Correction Type', placeholder: 'Select correction type', required: true, docUploader: 'shop', presetType: 'custom', options: ['Name Correction', 'Father Name Correction', 'DOB Correction', 'Address Change', 'Photo/Signature Update'] },
      { id: 'c4', type: 'text', label: 'New Corrected Value', placeholder: 'Enter the corrected data', required: true, docUploader: 'shop' },
      { id: 'c5', type: 'file', label: 'Existing PAN Card Copy', placeholder: '', required: true, docUploader: 'shop' },
      { id: 'c6', type: 'file', label: 'Proof Document for Correction', placeholder: '', required: true, docUploader: 'shop' },
      { id: 'c7', type: 'file', label: 'Corrected PAN (Result)', placeholder: '', required: false, docUploader: 'operator' }
    ]), adminId]
  );
  const subService2bId = ss2bRes.insertId;

  // Sub-Service 2c: PAN Reprint (single — 1 operator)
  const [ss2cRes] = await conn.query(
    `INSERT INTO sub_services (service_id, name, code, agent_fee, operator_share, admin_profit, form_schema, required_docs, is_active, created_by, fee, admin_commission_percentage, operator_assignment_mode)
     VALUES (?, 'PAN Card Reprint / Duplicate', 'PAN-REPRINT-001', 120.00, 96.00, 24.00, ?, '[]', true, ?, 120.00, 20.00, 'single')`,
    [service2Id, JSON.stringify([
      { id: 'r1', type: 'text', label: 'PAN Number', placeholder: 'ABCDE1234F', required: true, docUploader: 'shop' },
      { id: 'r2', type: 'text', label: 'Name on PAN Card', placeholder: 'Exactly as on PAN', required: true, docUploader: 'shop' },
      { id: 'r3', type: 'text', label: 'Mobile Number', placeholder: '10 digit mobile', required: true, docUploader: 'shop' },
      { id: 'r4', type: 'file', label: 'Aadhaar / ID Proof', placeholder: '', required: true, docUploader: 'shop' },
      { id: 'r5', type: 'file', label: 'Reprinted PAN Card (Result)', placeholder: '', required: false, docUploader: 'operator' }
    ]), adminId]
  );
  const subService2cId = ss2cRes.insertId;

  console.log(`   ✅ Service #2 created (ID: ${service2Id}) — Mode: AREA_WISE`);
  console.log(`      ├─ Sub-Service: "New PAN Card"        (ID: ${subService2aId}) — Mode: area_wise`);
  console.log(`      ├─ Sub-Service: "PAN Correction"      (ID: ${subService2bId}) — Mode: ward_wise`);
  console.log(`      └─ Sub-Service: "PAN Reprint"         (ID: ${subService2cId}) — Mode: single\n`);

  // ============================================================
  // STEP 6: ASSIGN OPERATORS TO SERVICES (Different Levels)
  // ============================================================
  console.log('🔗 Assigning Operators to Services...');

  // [Operator 1: Amit] → Aadhaar Update (SINGLE — he handles all of Gwalior)
  await conn.query(
    `INSERT INTO operator_assignments (operator_id, sub_service_id, district, area_label, ward_no, is_active)
     VALUES (?, ?, 'Gwalior', NULL, NULL, true)`,
    [operatorIds[0], subService1Id]
  );
  console.log(`   🔗 Amit Operator  → "Aadhaar Card Update" (SINGLE — Pure Gwalior)`);

  // [Operator 1: Amit] → PAN Reprint (SINGLE — he handles all)
  await conn.query(
    `INSERT INTO operator_assignments (operator_id, sub_service_id, district, area_label, ward_no, is_active)
     VALUES (?, ?, 'Gwalior', NULL, NULL, true)`,
    [operatorIds[0], subService2cId]
  );
  console.log(`   🔗 Amit Operator  → "PAN Reprint"         (SINGLE — Pure Gwalior)`);

  // [Operator 2: Suresh] → New PAN Card @ Morar Branch (AREA_WISE)
  await conn.query(
    `INSERT INTO operator_assignments (operator_id, sub_service_id, district, area_label, ward_no, is_active)
     VALUES (?, ?, 'Gwalior', 'Morar Branch Office', NULL, true)`,
    [operatorIds[1], subService2aId]
  );
  console.log(`   🔗 Suresh Operator → "New PAN Card"       (AREA_WISE — Morar Branch Office)`);

  // [Operator 3: Deepak] → New PAN Card @ Thatipur Center (AREA_WISE)
  await conn.query(
    `INSERT INTO operator_assignments (operator_id, sub_service_id, district, area_label, ward_no, is_active)
     VALUES (?, ?, 'Gwalior', 'Thatipur Center', NULL, true)`,
    [operatorIds[2], subService2aId]
  );
  console.log(`   🔗 Deepak Operator → "New PAN Card"       (AREA_WISE — Thatipur Center)`);

  // [Operator 1: Amit] → New PAN Card @ Main Office (AREA_WISE)
  await conn.query(
    `INSERT INTO operator_assignments (operator_id, sub_service_id, district, area_label, ward_no, is_active)
     VALUES (?, ?, 'Gwalior', 'Main Office Gwalior', NULL, true)`,
    [operatorIds[0], subService2aId]
  );
  console.log(`   🔗 Amit Operator  → "New PAN Card"        (AREA_WISE — Main Office Gwalior)`);

  // [Operator 2: Suresh] → PAN Correction @ Ward 7 (WARD_WISE)
  await conn.query(
    `INSERT INTO operator_assignments (operator_id, sub_service_id, district, area_label, ward_no, is_active)
     VALUES (?, ?, 'Gwalior', NULL, '7', true)`,
    [operatorIds[1], subService2bId]
  );
  console.log(`   🔗 Suresh Operator → "PAN Correction"     (WARD_WISE — Ward #7)`);

  // [Operator 3: Deepak] → PAN Correction @ Ward 14 (WARD_WISE)
  await conn.query(
    `INSERT INTO operator_assignments (operator_id, sub_service_id, district, area_label, ward_no, is_active)
     VALUES (?, ?, 'Gwalior', NULL, '14', true)`,
    [operatorIds[2], subService2bId]
  );
  console.log(`   🔗 Deepak Operator → "PAN Correction"     (WARD_WISE — Ward #14)`);

  // [Operator 1: Amit] → PAN Correction @ Ward 1 (WARD_WISE)
  await conn.query(
    `INSERT INTO operator_assignments (operator_id, sub_service_id, district, area_label, ward_no, is_active)
     VALUES (?, ?, 'Gwalior', NULL, '1', true)`,
    [operatorIds[0], subService2bId]
  );
  console.log(`   🔗 Amit Operator  → "PAN Correction"      (WARD_WISE — Ward #1)\n`);

  // ============================================================
  // DONE!
  // ============================================================
  console.log('═══════════════════════════════════════════════════════');
  console.log('✅ DATABASE RESET & SEED COMPLETE!');
  console.log('═══════════════════════════════════════════════════════');
  console.log('');
  console.log('📱 All Logins — Password: Test@1234');
  console.log('   👑 Admin       →  9999900001');
  console.log('   💼 Manager     →  9999900002');
  console.log('   🏬 Distributor →  9999900003');
  console.log('   🛍️  Agent       →  9999900004');
  console.log('   👨‍💻 Operator #1 →  9999900005 (Amit)');
  console.log('   👨‍💻 Operator #2 →  9999900006 (Suresh)');
  console.log('   👨‍💻 Operator #3 →  9999900007 (Deepak)');
  console.log('');
  console.log('📋 Services:');
  console.log('   1. "Aadhaar Card Update Service" — Direct (SINGLE mode)');
  console.log('   2. "PAN Card Services" — 3 Sub-Services:');
  console.log('      a. New PAN Card (AREA_WISE — 3 offices)');
  console.log('      b. PAN Correction (WARD_WISE — 3 wards)');
  console.log('      c. PAN Reprint (SINGLE — 1 operator)');
  console.log('═══════════════════════════════════════════════════════');

  await conn.end();
  process.exit(0);
}

main().catch(err => {
  console.error('❌ SEED ERROR:', err);
  process.exit(1);
});
