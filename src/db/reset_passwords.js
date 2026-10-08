import bcrypt from 'bcryptjs';
import pool from '../config/db.js';

async function updatePasswords() {
  const users = [
    { mobile: '9999900001', pass: 'Admin@123', role: 'super_admin' },
    { mobile: '9999900002', pass: 'Manager@123', role: 'manager' },
    { mobile: '9999900003', pass: 'Distributor@123', role: 'distributor' },
    { mobile: '9999900004', pass: 'Agent@123', role: 'agent' },
    { mobile: '9999900005', pass: 'Operator@123', role: 'operator' }
  ];

  for (const u of users) {
    const hash = await bcrypt.hash(u.pass, 10);
    await pool.query(
      "UPDATE users SET password_hash = ?, approval_status = 'approved', is_active = true WHERE mobile = ?",
      [hash, u.mobile]
    );
    console.log(`Updated user: ${u.role} (${u.mobile}) -> ${u.pass}`);
  }
  process.exit(0);
}

updatePasswords();
