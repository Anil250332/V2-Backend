import pool from '../config/db.js';

/**
 * GET /api/settings
 * Retrieve Helpline Number and Support Email for dynamic display across profiles
 */
export const getSettings = async (req, res) => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS system_settings (
        setting_key VARCHAR(50) PRIMARY KEY,
        setting_value TEXT NOT NULL
      )
    `);

    const [rows] = await pool.query('SELECT setting_key, setting_value FROM system_settings');
    const settingsMap = {};
    rows.forEach(r => {
      settingsMap[r.setting_key] = r.setting_value;
    });

    return res.status(200).json({
      status: 'success',
      data: {
        helplineNumber: settingsMap['helpline_number'] || '+91 0755 2700800',
        supportEmail: settingsMap['support_email'] || 'distributor-help@mponline.gov.in'
      }
    });
  } catch (error) {
    console.error('Get Settings Error:', error);
    return res.status(500).json({ status: 'error', message: error.message });
  }
};

/**
 * PUT /api/settings
 * Admin endpoint to update Helpline Number and Support Email
 */
export const updateSettings = async (req, res) => {
  try {
    const { helplineNumber, supportEmail } = req.body;

    await pool.query(`
      CREATE TABLE IF NOT EXISTS system_settings (
        setting_key VARCHAR(50) PRIMARY KEY,
        setting_value TEXT NOT NULL
      )
    `);

    if (helplineNumber) {
      await pool.query(
        'INSERT INTO system_settings (setting_key, setting_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE setting_value = ?',
        ['helpline_number', helplineNumber, helplineNumber]
      );
    }

    if (supportEmail) {
      await pool.query(
        'INSERT INTO system_settings (setting_key, setting_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE setting_value = ?',
        ['support_email', supportEmail, supportEmail]
      );
    }

    return res.status(200).json({
      status: 'success',
      message: 'System Helpline Number and Support Email updated successfully!',
      data: {
        helplineNumber: helplineNumber || '+91 0755 2700800',
        supportEmail: supportEmail || 'distributor-help@mponline.gov.in'
      }
    });
  } catch (error) {
    console.error('Update Settings Error:', error);
    return res.status(500).json({ status: 'error', message: error.message });
  }
};
