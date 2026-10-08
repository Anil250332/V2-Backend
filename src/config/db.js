import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const sslConfig = process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : undefined;

const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '3306', 10),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'v2online_portal',
  ssl: sslConfig,
  waitForConnections: true,
  connectionLimit: 15,
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0,
  charset: 'utf8mb4',
  dateStrings: true
};

export const pool = mysql.createPool(dbConfig);

/**
 * Auto-initialize database, schema & default seed on MySQL Database
 */
export const initDb = async () => {
  try {
    // 1. Check/Connect Database on MySQL server
    const rawConn = await mysql.createConnection({
      host: dbConfig.host,
      port: dbConfig.port,
      user: dbConfig.user,
      password: dbConfig.password,
      database: dbConfig.database,
      ssl: sslConfig,
      multipleStatements: true
    });

    try {
      await rawConn.query(
        `CREATE DATABASE IF NOT EXISTS \`${dbConfig.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`
      );
    } catch (e) {
      // Ignore if cloud DB user does not have global CREATE DATABASE privilege
    }

    // 2. Execute schema.sql if tables don't exist
    const schemaPath = path.join(__dirname, '../db/schema.sql');
    if (fs.existsSync(schemaPath)) {
      const schemaSql = fs.readFileSync(schemaPath, 'utf8');
      await rawConn.query(`USE \`${dbConfig.database}\`;\n` + schemaSql);
    }

    // Ensure dedicated shops table exists in MySQL database
    await rawConn.query(`
      USE \`${dbConfig.database}\`;
      CREATE TABLE IF NOT EXISTS shops (
        id BIGINT PRIMARY KEY AUTO_INCREMENT,
        shop_id_code VARCHAR(50) UNIQUE NOT NULL,
        user_id BIGINT UNIQUE NULL,
        owner_name VARCHAR(100) NOT NULL,
        shop_name VARCHAR(150) NOT NULL,
        mobile VARCHAR(15) UNIQUE NOT NULL,
        email VARCHAR(100) NULL,
        aadhaar_number VARCHAR(16) NULL,
        full_address TEXT NULL,
        district VARCHAR(100) NULL,
        tehsil VARCHAR(100) NULL,
        ward_no VARCHAR(50) NULL,
        distributor_id BIGINT NULL,
        status ENUM('pending', 'active', 'rejected', 'delete_requested') DEFAULT 'active',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (distributor_id) REFERENCES users(id) ON DELETE SET NULL
      );
    `);

    // Ensure sub_admin role exists in ENUM (for existing databases)
    try {
      await rawConn.query(`
        USE \`${dbConfig.database}\`;
        ALTER TABLE users MODIFY COLUMN role ENUM('super_admin', 'sub_admin', 'manager', 'distributor', 'operator', 'agent') NOT NULL;
      `);
    } catch (e) {
      // Ignore if already correct
    }

    // Ensure approval_status column exists in users table
    try {
      await rawConn.query(`
        USE \`${dbConfig.database}\`;
        ALTER TABLE users ADD COLUMN approval_status ENUM('pending', 'approved', 'rejected') DEFAULT 'approved';
      `);
    } catch (e) {}

    // Ensure applications table status column includes 'verified'
    try {
      await rawConn.query(`
        USE \`${dbConfig.database}\`;
        ALTER TABLE applications MODIFY COLUMN status ENUM('pending', 'assigned', 'processing', 'correction_required', 'completed', 'verified', 'rejected') DEFAULT 'pending';
      `);
    } catch (e) {}

    // Fix any invalid/empty status rows resulting from past truncation
    try {
      await rawConn.query(`
        USE \`${dbConfig.database}\`;
        UPDATE applications SET status = 'verified' WHERE status = '' OR status IS NULL OR status = '0';
      `);
    } catch (e) {}

    // Ensure services table has necessary columns for dynamic forms & sub-services
    try {
      await rawConn.query(`
        USE \`${dbConfig.database}\`;
        ALTER TABLE services ADD COLUMN icon_url VARCHAR(500) NULL;
      `);
    } catch (e) {}
    try {
      await rawConn.query(`
        USE \`${dbConfig.database}\`;
        ALTER TABLE services ADD COLUMN has_sub_services BOOLEAN DEFAULT FALSE;
      `);
    } catch (e) {}
    try {
      await rawConn.query(`
        USE \`${dbConfig.database}\`;
        ALTER TABLE services ADD COLUMN fee DECIMAL(10,2) DEFAULT 0.00;
      `);
    } catch (e) {}
    try {
      await rawConn.query(`
        USE \`${dbConfig.database}\`;
        ALTER TABLE services ADD COLUMN admin_commission_percentage DECIMAL(5,2) DEFAULT 0.00;
      `);
    } catch (e) {}
    try {
      await rawConn.query(`
        USE \`${dbConfig.database}\`;
        ALTER TABLE services ADD COLUMN form_schema JSON NULL;
      `);
    } catch (e) {}
    try {
      await rawConn.query(`
        USE \`${dbConfig.database}\`;
        ALTER TABLE services ADD COLUMN required_docs JSON NULL;
      `);
    } catch (e) {}

    try {
      await rawConn.query(`
        USE \`${dbConfig.database}\`;
        ALTER TABLE sub_services ADD COLUMN icon_url VARCHAR(500) NULL;
      `);
    } catch (e) {}
    try {
      await rawConn.query(`
        USE \`${dbConfig.database}\`;
        ALTER TABLE sub_services ADD COLUMN fee DECIMAL(10,2) DEFAULT 0.00;
      `);
    } catch (e) {}
    try {
      await rawConn.query(`
        USE \`${dbConfig.database}\`;
        ALTER TABLE sub_services ADD COLUMN admin_commission_percentage DECIMAL(5,2) DEFAULT 0.00;
      `);
    } catch (e) {}

    // Operator Assignment Mode columns for service-level operator routing
    try {
      await rawConn.query(`
        USE \`${dbConfig.database}\`;
        ALTER TABLE services ADD COLUMN operator_assignment_mode ENUM('single','area_wise','ward_wise') DEFAULT 'single';
      `);
    } catch (e) {}
    try {
      await rawConn.query(`
        USE \`${dbConfig.database}\`;
        ALTER TABLE sub_services ADD COLUMN operator_assignment_mode ENUM('single','area_wise','ward_wise') DEFAULT 'single';
      `);
    } catch (e) {}

    // Area label column for operator_assignments (office/area name)
    try {
      await rawConn.query(`
        USE \`${dbConfig.database}\`;
        ALTER TABLE operator_assignments ADD COLUMN area_label VARCHAR(150) NULL;
      `);
    } catch (e) {}

    // Custom fee column for operator_assignments (custom approved price for area/ward)
    try {
      await rawConn.query(`
        USE \`${dbConfig.database}\`;
        ALTER TABLE operator_assignments ADD COLUMN custom_fee DECIMAL(10,2) NULL;
      `);
    } catch (e) {}

    // Ensure operator_price_requests table exists
    await rawConn.query(`
      USE \`${dbConfig.database}\`;
      CREATE TABLE IF NOT EXISTS operator_price_requests (
        id BIGINT PRIMARY KEY AUTO_INCREMENT,
        request_no VARCHAR(50) UNIQUE NOT NULL,
        operator_id BIGINT NOT NULL,
        sub_service_id INT NOT NULL,
        assignment_id BIGINT NULL,
        routing_mode ENUM('single', 'area_wise', 'ward_wise') DEFAULT 'single',
        area_or_ward_label VARCHAR(150) NULL,
        current_price DECIMAL(10,2) NOT NULL,
        requested_price DECIMAL(10,2) NOT NULL,
        reason TEXT NULL,
        status ENUM('pending', 'approved', 'rejected') DEFAULT 'pending',
        admin_remarks TEXT NULL,
        reviewed_by BIGINT NULL,
        reviewed_at TIMESTAMP NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (operator_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (sub_service_id) REFERENCES sub_services(id) ON DELETE CASCADE,
        FOREIGN KEY (assignment_id) REFERENCES operator_assignments(id) ON DELETE SET NULL,
        FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL
      );
    `);

    await rawConn.end();

    // Auto-sync approved custom_fees from operator_assignments to sub_services and services
    try {
      await pool.query(`
        UPDATE sub_services ss
        JOIN operator_assignments oa ON ss.id = oa.sub_service_id
        SET ss.fee = oa.custom_fee
        WHERE oa.custom_fee IS NOT NULL AND oa.custom_fee > 0;
      `);
      await pool.query(`
        UPDATE services s
        JOIN sub_services ss ON s.id = ss.service_id
        SET s.fee = ss.fee
        WHERE ss.fee IS NOT NULL AND ss.fee > 0;
      `);
    } catch (e) {}

    // 3. Check and Seed Super Admin Demo Accounts
    const [adminRows] = await pool.query("SELECT id FROM users WHERE mobile IN ('9999900001', '9999999999') LIMIT 1");
    if (adminRows.length === 0) {
      const adminPasswordHash = await bcrypt.hash('Admin@123', 10);
      const adminUuid = crypto.randomUUID();

      const [insertRes] = await pool.query(
        `INSERT INTO users (
          uuid, role, full_name, mobile, email, password_hash, approval_status, is_active
        ) VALUES (?, 'super_admin', 'Super Admin Master', '9999900001', 'admin@v2online.in', ?, 'approved', true)`,
        [adminUuid, adminPasswordHash]
      );

      await pool.query('INSERT INTO wallets (user_id, balance) VALUES (?, 10000.00)', [insertRes.insertId]);

      console.log('👑 [Auto-Seed] Super Admin initialized: Mobile 9999900001 | Password Admin@123');
    }

    console.log(`✅ Connected to database '${dbConfig.database}' successfully!`);

    console.log(`✅ [XAMPP MySQL] Connected to database '${dbConfig.database}' successfully!`);
    return true;
  } catch (error) {
    console.error('❌ [XAMPP MySQL] Connection / Initialization error:', error.message);
    console.log('💡 Tip: Make sure XAMPP Control Panel me MySQL service "Start" hai.');
    return false;
  }
};

export default pool;
