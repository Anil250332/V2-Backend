import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

async function seedDatabase() {
  console.log('🌱 Seeding V2Online Portal Initial Data...');

  const connection = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '3306', 10),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'v2online_portal'
  });

  try {
    // 1. Seed Super Admin User if not exists
    const adminMobile = '9999999999';
    const [existingAdmin] = await connection.query('SELECT id FROM users WHERE mobile = ?', [adminMobile]);

    if (existingAdmin.length === 0) {
      const passwordHash = await bcrypt.hash('Admin@12345', 10);
      const adminUuid = crypto.randomUUID();

      const [res] = await connection.query(
        `INSERT INTO users (
          uuid, role, full_name, mobile, email, password_hash, approval_status, is_active
        ) VALUES (?, 'super_admin', 'Super Admin Master', ?, 'admin@v2online.in', ?, 'approved', true)`,
        [adminUuid, adminMobile, passwordHash]
      );

      const adminId = res.insertId;
      await connection.query('INSERT INTO wallets (user_id, balance) VALUES (?, 0.00)', [adminId]);

      console.log('👑 Super Admin account created successfully:');
      console.log(`   📱 Mobile: ${adminMobile}`);
      console.log(`   🔑 Password: Admin@12345`);
    } else {
      console.log('ℹ️ Super Admin account already exists.');
    }

    // 2. Seed Initial Service Categories if empty
    const [categories] = await connection.query('SELECT id FROM service_categories LIMIT 1');
    if (categories.length === 0) {
      console.log('📦 Seeding default service categories...');
      await connection.query(`
        INSERT INTO service_categories (name, icon, display_order, is_active) VALUES
        ('Samagra ID Services', 'id-card', 1, true),
        ('MP e-District Services', 'file-text', 2, true),
        ('Sambal Card Services', 'award', 3, true),
        ('MP Ration Card Services', 'shopping-bag', 4, true),
        ('Ayushman Bharat Services', 'heart-pulse', 5, true);
      `);
      console.log('✅ Service categories seeded!');
    }

    console.log('\n🎉 Seed completed successfully!');
  } catch (error) {
    console.error('❌ Seeding error:', error.message);
  } finally {
    await connection.end();
  }
}

seedDatabase();
