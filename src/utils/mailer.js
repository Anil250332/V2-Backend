import nodemailer from 'nodemailer';
import pool from '../config/db.js';

/**
 * Lazy creation of Nodemailer Transporter
 */
const getTransporter = () => {
  const host = (process.env.SMTP_HOST || 'smtp.gmail.com').trim();
  const user = (process.env.SMTP_USER || '').trim();
  const pass = (process.env.SMTP_PASS || '').trim();

  if (host.includes('gmail.com') || user.includes('gmail.com')) {
    return nodemailer.createTransport({
      service: 'gmail',
      auth: user && pass ? { user, pass } : undefined,
      connectionTimeout: 5000,
      socketTimeout: 5000,
      greetingTimeout: 5000
    });
  }

  const port = parseInt((process.env.SMTP_PORT || '587').trim(), 10);
  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: user && pass ? { user, pass } : undefined,
    tls: {
      rejectUnauthorized: false
    },
    connectionTimeout: 5000,
    socketTimeout: 5000,
    greetingTimeout: 5000
  });
};

/**
 * Core sendEmail helper with non-blocking error catching and strict timeouts
 */
export const sendEmail = async ({ to, subject, html, text }) => {
  if (!to) {
    console.log('ℹ️ [Mailer] No recipient email provided. Skipping email dispatch.');
    return false;
  }

  const user = (process.env.SMTP_USER || '').trim();
  const pass = (process.env.SMTP_PASS || '').trim();

  // For Gmail, From header MUST match the authenticated Gmail account user to avoid Gmail 550/554 SendAsDenied rejection
  const isGmail = (process.env.SMTP_HOST || '').includes('gmail.com') || user.includes('gmail.com');
  const defaultFrom = user ? `"V2Online MP Portal" <${user}>` : '"V2Online MP Portal" <no-reply@v2onlineportal.com>';
  
  const from = (isGmail && user) 
    ? `"V2Online MP Portal" <${user}>`
    : ((process.env.EMAIL_FROM && !process.env.EMAIL_FROM.includes('no-reply@v2onlineportal.com')) 
        ? process.env.EMAIL_FROM 
        : defaultFrom);

  // Check if SMTP credentials are configured
  if (!user || !pass) {
    console.log(`\n================ EMAIL NOTIFICATION (DEV SIMULATION) ================`);
    console.log(`To: ${to}`);
    console.log(`From: ${from}`);
    console.log(`Subject: ${subject}`);
    console.log(`Body (Text): ${text || 'HTML Content Attached'}`);
    console.log(`---------------------------------------------------------------------`);
    console.log(`💡 Note: To send real emails, configure SMTP_USER & SMTP_PASS in backend/.env`);
    console.log(`=====================================================================\n`);
    return true;
  }

  try {
    const transporter = getTransporter();
    
    // Wrap email dispatch in a 6-second timeout race guard
    const emailPromise = transporter.sendMail({
      from,
      to,
      subject,
      text: text || '',
      html
    });

    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('SMTP Connection Timeout (6s)')), 6000)
    );

    const info = await Promise.race([emailPromise, timeoutPromise]);
    console.log(`📧 [Mailer] Email successfully sent to ${to} | MessageID: ${info.messageId}`);
    return true;
  } catch (error) {
    console.error(`❌ [Mailer Error] Failed to send email to ${to}:`, error.message);
    return false; // Return false but do not throw to prevent blocking calling endpoints
  }
};

/**
 * Base HTML Template wrapper for consistent modern styling
 */
const wrapTemplate = (title, contentHtml) => `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    body {
      font-family: 'Segoe UI', -apple-system, BlinkMacSystemFont, Roboto, Helvetica, Arial, sans-serif;
      background-color: #0f172a;
      margin: 0;
      padding: 30px 12px;
      color: #334155;
      -webkit-font-smoothing: antialiased;
    }
    .wrapper {
      max-width: 600px;
      margin: 0 auto;
    }
    .top-bar {
      height: 6px;
      background: linear-gradient(90deg, #3b82f6 0%, #6366f1 50%, #10b981 100%);
      border-radius: 16px 16px 0 0;
    }
    .container {
      background: #ffffff;
      border-radius: 0 0 18px 18px;
      overflow: hidden;
      border: 1px solid #e2e8f0;
      box-shadow: 0 20px 40px -15px rgba(0, 0, 0, 0.3);
    }
    .header {
      background: linear-gradient(135deg, #0f172a 0%, #1e293b 100%);
      padding: 28px 24px;
      text-align: center;
    }
    .brand-box {
      display: inline-block;
      background: rgba(255, 255, 255, 0.08);
      padding: 8px 18px;
      border-radius: 12px;
      border: 1px solid rgba(255, 255, 255, 0.15);
      margin-bottom: 6px;
    }
    .logo-v2 {
      font-size: 20px;
      font-weight: 900;
      color: #38bdf8;
      letter-spacing: -0.5px;
    }
    .logo-online {
      font-size: 18px;
      font-weight: 800;
      color: #f59e0b;
      letter-spacing: 1px;
    }
    .header p {
      margin: 6px 0 0 0;
      font-size: 11px;
      color: #94a3b8;
      text-transform: uppercase;
      letter-spacing: 2px;
      font-weight: 700;
    }
    .body {
      padding: 32px 28px;
      background: #ffffff;
    }
    .badge {
      display: inline-block;
      padding: 5px 14px;
      border-radius: 9999px;
      font-size: 11px;
      font-weight: 800;
      letter-spacing: 0.5px;
      text-transform: uppercase;
    }
    .badge-primary { background: #eff6ff; color: #2563eb; border: 1px solid #bfdbfe; }
    .badge-success { background: #f0fdf4; color: #166534; border: 1px solid #bbf7d0; }
    .badge-warning { background: #fffbebf8; color: #b45309; border: 1px solid #fef08a; }
    .badge-danger { background: #fef2f2; color: #991b1b; border: 1px solid #fecaca; }
    
    .box {
      background: #f8fafc;
      border: 1px solid #e2e8f0;
      border-left: 4px solid #3b82f6;
      border-radius: 12px;
      padding: 16px 20px;
      margin: 20px 0;
    }
    .box-warning {
      background: #fffbebf8;
      border: 1px solid #fde68a;
      border-left: 4px solid #f59e0b;
    }
    .box-success {
      background: #f0fdf4;
      border: 1px solid #bbf7d0;
      border-left: 4px solid #10b981;
    }

    .otp-card {
      background: linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%);
      border: 2px dashed #3b82f6;
      border-radius: 16px;
      padding: 24px;
      text-align: center;
      margin: 24px 0;
    }
    .otp-code {
      font-size: 38px;
      font-weight: 900;
      letter-spacing: 10px;
      color: #1d4ed8;
      font-family: 'Courier New', Courier, monospace;
      margin: 8px 0;
    }
    .table-info {
      width: 100%;
      border-collapse: separate;
      border-spacing: 0;
      margin: 20px 0;
      font-size: 13px;
      border: 1px solid #e2e8f0;
      border-radius: 12px;
      overflow: hidden;
    }
    .table-info tr:nth-child(even) { background-color: #f8fafc; }
    .table-info tr:nth-child(odd) { background-color: #ffffff; }
    .table-info td {
      padding: 12px 16px;
      border-bottom: 1px solid #f1f5f9;
    }
    .table-info tr:last-child td { border-bottom: none; }
    .table-info td.label {
      font-weight: 600;
      color: #64748b;
      width: 42%;
    }
    .table-info td.value {
      font-weight: 700;
      color: #0f172a;
      text-align: right;
    }
    .footer {
      background: #0f172a;
      padding: 24px;
      text-align: center;
      font-size: 11px;
      color: #94a3b8;
    }
    .footer p { margin: 4px 0; }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="top-bar"></div>
    <div class="container">
      <div class="header">
        <div class="brand-box">
          <span class="logo-v2">V2</span>
          <span class="logo-online">ONLINE</span>
        </div>
        <p>Citizen Services & MP Online Portal</p>
      </div>
      <div class="body">
        ${contentHtml}
      </div>
      <div class="footer">
        <p>© 2026 V2Online Citizen Services Portal. All rights reserved.</p>
        <p style="color:#64748b; font-size:10px; margin-top:6px;">
          This is an automated operational notification. Please do not reply directly to this email.
        </p>
      </div>
    </div>
  </div>
</body>
</html>
`;

// Helper to fetch admin emails from DB
export const getAdminEmails = async () => {
  try {
    const [admins] = await pool.query(
      `SELECT email FROM users WHERE role IN ('super_admin', 'sub_admin') AND is_active = true AND email IS NOT NULL AND email != ''`
    );
    const emails = admins.map(a => a.email).filter(Boolean);
    if (emails.length === 0) {
      const envAdmin = process.env.ADMIN_EMAIL || 'admin@mponlineportal.com';
      return [envAdmin];
    }
    return emails;
  } catch (error) {
    console.error('Failed to fetch admin emails:', error.message);
    return [process.env.ADMIN_EMAIL || 'admin@mponlineportal.com'];
  }
};

// Helper to fetch manager and admin emails from DB
export const getAdminAndManagerEmails = async () => {
  try {
    const [users] = await pool.query(
      `SELECT email FROM users WHERE role IN ('super_admin', 'sub_admin', 'manager') AND is_active = true AND email IS NOT NULL AND email != ''`
    );
    const emails = users.map(u => u.email).filter(Boolean);
    if (emails.length === 0) {
      return [process.env.ADMIN_EMAIL || 'admin@mponlineportal.com'];
    }
    return emails;
  } catch (error) {
    console.error('Failed to fetch admin/manager emails:', error.message);
    return [process.env.ADMIN_EMAIL || 'admin@mponlineportal.com'];
  }
};

/* ==========================================================================
   SPECIFIC EMAIL NOTIFICATION DISPATCHERS
   ========================================================================== */

/**
 * 1. OTP Email for Registration & Resend
 */
export const sendOtpEmail = async (toEmail, otp, userName = 'User') => {
  if (!toEmail) return;
  const subject = `🔐 [V2Online] ${otp} is your Registration Verification OTP`;
  const html = wrapTemplate(
    'Registration Verification OTP',
    `
      <div style="text-align:right;"><span class="badge badge-primary">Verification</span></div>
      <h2 style="margin-top:0; color:#0f172a; font-size:20px; font-weight:800;">Hello ${userName}, 👋</h2>
      <p style="font-size:14px; color:#475569; line-height:1.6;">
        Welcome to <strong>V2Online Services Portal</strong>! Please use the 6-digit verification code below to complete your registration:
      </p>
      
      <div class="otp-card">
        <div style="font-size:11px; font-weight:700; text-transform:uppercase; color:#3b82f6; letter-spacing:1px; margin-bottom:4px;">
          Your Security Code
        </div>
        <div class="otp-code">${otp}</div>
        <div style="font-size:11px; color:#64748b; margin-top:4px;">
          Valid for <strong>5 Minutes</strong>
        </div>
      </div>

      <div class="box box-warning">
        <p style="margin:0; font-size:12px; color:#92400e; line-height:1.5;">
          <strong>⏱️ Expiry Notice:</strong> This OTP will expire in <strong>5 minutes</strong>. If it expires, you can click 'Resend Email OTP' on the portal.
        </p>
      </div>

      <p style="font-size:12px; color:#94a3b8; margin-top:24px;">
        If you did not initiate this registration request, please ignore this email safely.
      </p>
    `
  );

  return sendEmail({ to: toEmail, subject, html, text: `Your V2Online Verification OTP is: ${otp}. Valid for 5 minutes.` });
};

/**
 * 1.b. OTP Email for Forgot Password & Reset (Valid for 15 minutes)
 */
export const sendPasswordResetOtpEmail = async (toEmail, otp, userName = 'User') => {
  if (!toEmail) return;
  const subject = `🔑 [V2Online] ${otp} is your Password Reset OTP`;
  const html = wrapTemplate(
    'Password Reset OTP Verification',
    `
      <div style="text-align:right;"><span class="badge badge-warning">Security Verification</span></div>
      <h2 style="margin-top:0; color:#0f172a; font-size:20px; font-weight:800;">Hello ${userName}, 👋</h2>
      <p style="font-size:14px; color:#475569; line-height:1.6;">
        We received a request to reset the password for your <strong>V2Online Portal</strong> account.
        Use the 6-digit code below to set a new password:
      </p>
      
      <div class="otp-card">
        <div style="font-size:11px; font-weight:700; text-transform:uppercase; color:#2563eb; letter-spacing:1px; margin-bottom:4px;">
          Password Reset Code
        </div>
        <div class="otp-code">${otp}</div>
        <div style="font-size:11px; color:#64748b; margin-top:4px;">
          Valid for <strong>15 Minutes</strong>
        </div>
      </div>

      <div class="box box-warning">
        <p style="margin:0; font-size:12px; color:#92400e; line-height:1.5;">
          <strong>⏱️ Security Warning:</strong> This password reset code is valid for <strong>15 minutes</strong>. Do not share this OTP with anyone.
        </p>
      </div>

      <p style="font-size:12px; color:#94a3b8; margin-top:24px;">
        If you did not request a password reset, please ignore this message or contact portal administration immediately.
      </p>
    `
  );

  return sendEmail({ to: toEmail, subject, html, text: `Your V2Online Password Reset OTP is: ${otp}. Valid for 15 minutes.` });
};

/**
 * 2. Admin Alert: New Self-Registration (Agent or Operator)
 */
export const sendAdminRegistrationAlert = async ({ name, mobile, email, role, shopName }) => {
  const adminEmails = await getAdminEmails();
  const roleLabel = role === 'agent' ? 'MP Online Agent (Shop)' : 'Operator (Officer)';
  const subject = `🔔 [Admin Alert] New ${roleLabel} Registration Pending: ${name}`;

  const html = wrapTemplate(
    'New User Registration Alert',
    `
      <div style="text-align:right;"><span class="badge badge-warning">Pending Review</span></div>
      <h2 style="margin-top:0; color:#0f172a; font-size:20px; font-weight:800;">New Registration Request</h2>
      <p style="font-size:14px; color:#475569; line-height:1.6;">
        A new partner has registered on <strong>V2Online Portal</strong> and requires administrative verification.
      </p>

      <table class="table-info">
        <tr><td class="label">Full Name</td><td class="value">${name}</td></tr>
        <tr><td class="label">Role Requested</td><td class="value">${roleLabel}</td></tr>
        <tr><td class="label">Mobile Number</td><td class="value">+91-${mobile}</td></tr>
        <tr><td class="label">Email Address</td><td class="value">${email || 'N/A'}</td></tr>
        <tr><td class="label">Shop / Office</td><td class="value">${shopName || 'N/A'}</td></tr>
      </table>

      <div class="box box-warning">
        <p style="margin:0; font-size:12px; color:#92400e; line-height:1.5;">
          <strong>⚡ Action Required:</strong> Please log into <strong>Admin Dashboard -> Approvals</strong> to verify documents and approve/reject this account.
        </p>
      </div>
    `
  );

  return sendEmail({ to: adminEmails.join(','), subject, html });
};

/**
 * 3. User Notification: Registration Approved / Rejected by Admin
 */
export const sendUserApprovalEmail = async ({ toEmail, name, role, status }) => {
  if (!toEmail) return;
  const isApproved = status === 'approved';
  const subject = isApproved 
    ? `🎉 Account Approved! Welcome to V2Online Portal`
    : `Account Registration Update - V2Online Portal`;

  const html = wrapTemplate(
    'Account Status Update',
    `
      <div style="text-align:right;">
        <span class="badge ${isApproved ? 'badge-success' : 'badge-danger'}">
          ${isApproved ? 'APPROVED' : 'REJECTED'}
        </span>
      </div>
      <h2 style="margin-top:0; color:#0f172a; font-size:20px; font-weight:800;">Hello ${name}, 👋</h2>
      ${
        isApproved ? `
          <p style="font-size:14px; color:#475569; line-height:1.6;">
            Great news! Your registration request as <strong>${role.toUpperCase()}</strong> has been <strong>APPROVED</strong> by the portal administration.
          </p>
          <div class="box box-success">
            <p style="margin:0; font-size:13px; color:#166534; font-weight:700;">
              ✅ Account Activated! You can now log into your dashboard using your registered mobile number and password.
            </p>
          </div>
        ` : `
          <p style="font-size:14px; color:#475569; line-height:1.6;">
            We regret to inform you that your registration request as <strong>${role.toUpperCase()}</strong> has been <strong>REJECTED</strong> or set to inactive by administration.
          </p>
          <div class="box" style="border-left-color:#ef4444; background:#fef2f2;">
            <p style="margin:0; font-size:12px; color:#991b1b;">
              Please contact portal support if you believe this decision was made in error.
            </p>
          </div>
        `
      }
    `
  );

  return sendEmail({ to: toEmail, subject, html });
};

/**
 * 4. User Notification: Created by Admin/Manager/Distributor
 */
export const sendUserCreatedEmail = async ({ toEmail, name, role, mobile, tempPassword, createdByRole }) => {
  if (!toEmail) return;
  const subject = `Welcome to V2Online Portal! Account Created by ${createdByRole || 'Admin'}`;
  const html = wrapTemplate(
    'Welcome to V2Online Portal',
    `
      <div style="text-align:right;"><span class="badge badge-success">Account Created</span></div>
      <h2 style="margin-top:0; color:#0f172a; font-size:20px; font-weight:800;">Hello ${name}, 👋</h2>
      <p style="font-size:14px; color:#475569; line-height:1.6;">
        An account has been created for you on <strong>V2Online Portal</strong> by your ${createdByRole || 'Admin'}.
      </p>

      <table class="table-info">
        <tr><td class="label">Assigned Role</td><td class="value">${role.toUpperCase()}</td></tr>
        <tr><td class="label">Login Mobile</td><td class="value">${mobile}</td></tr>
        ${tempPassword ? `<tr><td class="label">Temporary Password</td><td class="value">${tempPassword}</td></tr>` : ''}
      </table>

      <div class="box">
        <p style="margin:0; font-size:12px; color:#334155;">
          🔒 <strong>Security Advice:</strong> Please log into the portal and update your password immediately after first sign in.
        </p>
      </div>
    `
  );

  return sendEmail({ to: toEmail, subject, html });
};

/**
 * 5. Admin Notification: Distributor Created a User
 */
export const sendDistributorUserAddedAlertToAdmin = async ({ distributorName, newUserName, newUserRole, newUserMobile }) => {
  const adminEmails = await getAdminEmails();
  const subject = `[Distributor Action] ${distributorName} added new ${newUserRole}: ${newUserName}`;

  const html = wrapTemplate(
    'Distributor Added User',
    `
      <div style="text-align:right;"><span class="badge badge-primary">Distributor Action</span></div>
      <h2 style="margin-top:0; color:#0f172a; font-size:20px; font-weight:800;">New Account Added by Distributor</h2>
      <p style="font-size:14px; color:#475569;">
        Distributor <strong>${distributorName}</strong> has created a new partner account on the portal.
      </p>

      <table class="table-info">
        <tr><td class="label">Distributor Name</td><td class="value">${distributorName}</td></tr>
        <tr><td class="label">New User Name</td><td class="value">${newUserName}</td></tr>
        <tr><td class="label">Role</td><td class="value">${newUserRole}</td></tr>
        <tr><td class="label">Mobile</td><td class="value">${newUserMobile}</td></tr>
      </table>
    `
  );

  return sendEmail({ to: adminEmails.join(','), subject, html });
};

/**
 * 6. Operator Notification: Service Application Assigned
 */
export const sendTaskAssignmentEmail = async ({ toEmail, operatorName, applicationNo, serviceName, shopName }) => {
  if (!toEmail) return;
  const subject = `📋 New Task Assigned: App #${applicationNo} (${serviceName})`;
  const html = wrapTemplate(
    'New Task Assigned',
    `
      <div style="text-align:right;"><span class="badge badge-warning">Action Required</span></div>
      <h2 style="margin-top:0; color:#0f172a; font-size:20px; font-weight:800;">Hello ${operatorName}, 👋</h2>
      <p style="font-size:14px; color:#475569; line-height:1.6;">
        A new service application matching your assigned area/service has been submitted and assigned to you for processing:
      </p>

      <table class="table-info">
        <tr><td class="label">Application No</td><td class="value">#${applicationNo}</td></tr>
        <tr><td class="label">Service Name</td><td class="value">${serviceName}</td></tr>
        <tr><td class="label">Submitted By (Shop)</td><td class="value">${shopName}</td></tr>
      </table>

      <div class="box">
        <p style="margin:0; font-size:12px; color:#334155;">
          ⚡ Please log into your <strong>Operator Dashboard -> My Tasks</strong> to process this request.
        </p>
      </div>
    `
  );

  return sendEmail({ to: toEmail, subject, html });
};

/**
 * 7. Shop Agent Notification: Task Completed / Processed by Operator
 */
export const sendTaskCompletedEmail = async ({ toEmail, shopOwnerName, applicationNo, serviceName, status }) => {
  if (!toEmail) return;
  const isCompleted = status === 'completed';
  const subject = isCompleted
    ? `✅ Application Completed: App #${applicationNo} (${serviceName})`
    : `❌ Application Rejected: App #${applicationNo} (${serviceName})`;

  const html = wrapTemplate(
    'Task Processing Status',
    `
      <div style="text-align:right;">
        <span class="badge ${isCompleted ? 'badge-success' : 'badge-danger'}">
          ${isCompleted ? 'COMPLETED' : 'REJECTED'}
        </span>
      </div>
      <h2 style="margin-top:0; color:#0f172a; font-size:20px; font-weight:800;">Hello ${shopOwnerName || 'Partner'}, 👋</h2>
      <p style="font-size:14px; color:#475569; line-height:1.6;">
        Your service application <strong>#${applicationNo}</strong> for <strong>${serviceName}</strong> has been processed by the assigned operator.
      </p>

      <table class="table-info">
        <tr><td class="label">Application No</td><td class="value">#${applicationNo}</td></tr>
        <tr><td class="label">Service Name</td><td class="value">${serviceName}</td></tr>
        <tr><td class="label">Final Status</td><td class="value">${status.toUpperCase()}</td></tr>
      </table>

      <div class="box ${isCompleted ? 'box-success' : ''}">
        <p style="margin:0; font-size:12px; color:${isCompleted ? '#166534' : '#991b1b'};">
          Log into your <strong>Shop Dashboard -> Applications</strong> to download output documents or view remarks.
        </p>
      </div>
    `
  );

  return sendEmail({ to: toEmail, subject, html });
};

/**
 * 8. Shop Agent Notification: Wallet Fee Deducted for Service Application
 */
export const sendWalletDebitEmail = async ({ toEmail, shopName, applicationNo, serviceName, amountDeducted, remainingBalance }) => {
  if (!toEmail) return;
  const subject = `💸 Wallet Debit Alert: ₹${amountDeducted} for App #${applicationNo}`;
  const html = wrapTemplate(
    'Wallet Debit Confirmation',
    `
      <div style="text-align:right;"><span class="badge badge-primary">Debit Txn</span></div>
      <h2 style="margin-top:0; color:#0f172a; font-size:20px; font-weight:800;">Wallet Amount Deducted</h2>
      <p style="font-size:14px; color:#475569; line-height:1.6;">
        An amount of <strong>₹${parseFloat(amountDeducted).toFixed(2)}</strong> has been deducted from your wallet for service application submission.
      </p>

      <table class="table-info">
        <tr><td class="label">Application No</td><td class="value">#${applicationNo}</td></tr>
        <tr><td class="label">Service Name</td><td class="value">${serviceName}</td></tr>
        <tr><td class="label">Deducted Amount</td><td class="value" style="color:#dc2626; font-size:15px;">- ₹${parseFloat(amountDeducted).toFixed(2)}</td></tr>
        <tr><td class="label">Remaining Balance</td><td class="value" style="color:#2563eb; font-size:15px;">₹${parseFloat(remainingBalance).toFixed(2)}</td></tr>
      </table>
    `
  );

  return sendEmail({ to: toEmail, subject, html });
};

/**
 * 9. Shop Agent Notification: Successful Wallet Recharge
 */
export const sendWalletCreditEmail = async ({ toEmail, shopName, amount, newBalance, txnId }) => {
  if (!toEmail) return;
  const subject = `💰 Wallet Recharge Successful: ₹${amount} Added!`;
  const html = wrapTemplate(
    'Wallet Credit Successful',
    `
      <div style="text-align:right;"><span class="badge badge-success">Credit Txn</span></div>
      <h2 style="margin-top:0; color:#0f172a; font-size:20px; font-weight:800;">Wallet Recharge Confirmed 🎉</h2>
      <p style="font-size:14px; color:#475569; line-height:1.6;">
        Great news! Your wallet has been successfully credited with <strong>₹${parseFloat(amount).toFixed(2)}</strong>.
      </p>

      <table class="table-info">
        ${txnId ? `<tr><td class="label">Transaction Reference</td><td class="value">${txnId}</td></tr>` : ''}
        <tr><td class="label">Credited Amount</td><td class="value" style="color:#16a34a; font-size:15px;">+ ₹${parseFloat(amount).toFixed(2)}</td></tr>
        <tr><td class="label">Updated Balance</td><td class="value" style="color:#2563eb; font-size:15px;">₹${parseFloat(newBalance).toFixed(2)}</td></tr>
      </table>
    `
  );

  return sendEmail({ to: toEmail, subject, html });
};

/**
 * 10. Admin Notification: Operator Withdrawal Requested
 */
export const sendWithdrawalRequestAlertToAdmin = async ({ operatorName, amount, paymentMethod, upiId }) => {
  const adminEmails = await getAdminEmails();
  const subject = `[Withdrawal Request] ₹${amount} requested by Operator ${operatorName}`;

  const html = wrapTemplate(
    'Withdrawal Request Alert',
    `
      <div style="text-align:right;"><span class="badge badge-warning">Pending Review</span></div>
      <h2 style="margin-top:0; color:#0f172a; font-size:20px; font-weight:800;">New Withdrawal Request</h2>
      <p style="font-size:14px; color:#475569;">
        Operator <strong>${operatorName}</strong> has submitted a request to withdraw earned commission funds.
      </p>

      <table class="table-info">
        <tr><td class="label">Operator Name</td><td class="value">${operatorName}</td></tr>
        <tr><td class="label">Requested Amount</td><td class="value">₹${parseFloat(amount).toFixed(2)}</td></tr>
        <tr><td class="label">Payment Method</td><td class="value">${paymentMethod || 'UPI/Bank'}</td></tr>
        <tr><td class="label">UPI / Details</td><td class="value">${upiId || 'N/A'}</td></tr>
      </table>
    `
  );

  return sendEmail({ to: adminEmails.join(','), subject, html });
};

/**
 * 11. Operator Notification: Withdrawal Status Update
 */
export const sendWithdrawalStatusEmail = async ({ toEmail, operatorName, amount, status, note }) => {
  if (!toEmail) return;
  const isApproved = status === 'approved' || status === 'completed';
  const subject = isApproved 
    ? `✅ Withdrawal Approved: ₹${amount} Transferred`
    : `❌ Withdrawal Request Rejected: ₹${amount}`;

  const html = wrapTemplate(
    'Withdrawal Status Update',
    `
      <div style="text-align:right;">
        <span class="badge ${isApproved ? 'badge-success' : 'badge-danger'}">
          ${isApproved ? 'APPROVED' : 'REJECTED'}
        </span>
      </div>
      <h2 style="margin-top:0; color:#0f172a; font-size:20px; font-weight:800;">Hello ${operatorName}, 👋</h2>
      <p style="font-size:14px; color:#475569; line-height:1.6;">
        Your withdrawal request of <strong>₹${parseFloat(amount).toFixed(2)}</strong> has been <strong>${status.toUpperCase()}</strong> by Administration.
      </p>

      ${note ? `<div class="box"><p style="margin:0; font-size:12px; color:#475569;"><strong>Admin Note:</strong> ${note}</p></div>` : ''}
    `
  );

  return sendEmail({ to: toEmail, subject, html });
};

/**
 * 12. Admin Notification: Operator Requested Custom Price / Rate Change
 */
export const sendRateRequestAlertToAdmin = async ({ operatorName, serviceName, requestedRate, currentPrice }) => {
  const adminEmails = await getAdminEmails();
  const subject = `[Rate Change Request] ${operatorName} requested rate change for ${serviceName}`;

  const html = wrapTemplate(
    'Service Price Request Alert',
    `
      <div style="text-align:right;"><span class="badge badge-warning">Price Review</span></div>
      <h2 style="margin-top:0; color:#0f172a; font-size:20px; font-weight:800;">Operator Custom Rate Request</h2>
      <p style="font-size:14px; color:#475569;">
        Operator <strong>${operatorName}</strong> requested a custom rate modification for <strong>${serviceName}</strong>.
      </p>

      <table class="table-info">
        <tr><td class="label">Operator Name</td><td class="value">${operatorName}</td></tr>
        <tr><td class="label">Service Name</td><td class="value">${serviceName}</td></tr>
        <tr><td class="label">Current Base Price</td><td class="value">₹${parseFloat(currentPrice).toFixed(2)}</td></tr>
        <tr><td class="label">Requested Operator Rate</td><td class="value" style="color:#2563eb;">₹${parseFloat(requestedRate).toFixed(2)}</td></tr>
      </table>
    `
  );

  return sendEmail({ to: adminEmails.join(','), subject, html });
};

/**
 * 13. Operator Notification: Price Request Decision
 */
export const sendRateReviewDecisionEmail = async ({ toEmail, operatorName, serviceName, approvedRate, status }) => {
  if (!toEmail) return;
  const isApproved = status === 'approved';
  const subject = isApproved 
    ? `✅ Rate Request Approved for ${serviceName}`
    : `❌ Rate Request Rejected for ${serviceName}`;

  const html = wrapTemplate(
    'Rate Change Review Update',
    `
      <div style="text-align:right;">
        <span class="badge ${isApproved ? 'badge-success' : 'badge-danger'}">
          ${isApproved ? 'APPROVED' : 'REJECTED'}
        </span>
      </div>
      <h2 style="margin-top:0; color:#0f172a; font-size:20px; font-weight:800;">Hello ${operatorName}, 👋</h2>
      <p style="font-size:14px; color:#475569; line-height:1.6;">
        Your custom rate request for service <strong>${serviceName}</strong> has been <strong>${status.toUpperCase()}</strong>.
      </p>

      ${isApproved ? `
        <table class="table-info">
          <tr><td class="label">Final Approved Rate</td><td class="value" style="color:#16a34a; font-size:15px;">₹${parseFloat(approvedRate).toFixed(2)}</td></tr>
        </table>
      ` : ''}
    `
  );

  return sendEmail({ to: toEmail, subject, html });
};

/**
 * 14. Admin & Manager Notification: New Complaint Ticket Registered
 */
export const sendComplaintTicketAlertToAdminsAndManagers = async ({ ticketId, shopName, subject, priority }) => {
  const recipientEmails = await getAdminAndManagerEmails();
  const emailSubject = `[Complaint Ticket #${ticketId}] New Ticket Registered (${priority || 'Normal'})`;

  const html = wrapTemplate(
    'New Support Ticket Alert',
    `
      <div style="text-align:right;"><span class="badge badge-danger">Support Ticket</span></div>
      <h2 style="margin-top:0; color:#0f172a; font-size:20px; font-weight:800;">New Complaint Registered</h2>
      <p style="font-size:14px; color:#475569;">
        A new complaint ticket <strong>#${ticketId}</strong> has been submitted by <strong>${shopName || 'Shop Partner'}</strong>.
      </p>

      <table class="table-info">
        <tr><td class="label">Ticket ID</td><td class="value">#${ticketId}</td></tr>
        <tr><td class="label">Submitted By</td><td class="value">${shopName || 'N/A'}</td></tr>
        <tr><td class="label">Subject</td><td class="value">${subject}</td></tr>
        <tr><td class="label">Priority</td><td class="value">${priority || 'Normal'}</td></tr>
      </table>
    `
  );

  return sendEmail({ to: recipientEmails.join(','), subject: emailSubject, html });
};

/**
 * 15. Complainant Notification: Ticket Resolved
 */
export const sendComplaintResolvedEmail = async ({ toEmail, shopName, ticketId, resolutionNote }) => {
  if (!toEmail) return;
  const subject = `✅ Support Ticket #${ticketId} Resolved`;
  const html = wrapTemplate(
    'Ticket Resolution Update',
    `
      <div style="text-align:right;"><span class="badge badge-success">RESOLVED</span></div>
      <h2 style="margin-top:0; color:#0f172a; font-size:20px; font-weight:800;">Hello ${shopName || 'Partner'}, 👋</h2>
      <p style="font-size:14px; color:#475569; line-height:1.6;">
        Your support complaint ticket <strong>#${ticketId}</strong> has been resolved by our support team.
      </p>

      ${resolutionNote ? `
        <div class="box box-success">
          <p style="margin:0; font-size:13px; color:#166534;"><strong>Resolution Remarks:</strong> ${resolutionNote}</p>
        </div>
      ` : ''}
    `
  );

  return sendEmail({ to: toEmail, subject, html });
};

/**
 * 16. Shop Agent Notification: Task Verified & Approved by Admin
 */
export const sendTaskVerifiedEmail = async ({ toEmail, shopOwnerName, applicationNo, serviceName }) => {
  if (!toEmail) return;
  const subject = `🎉 Application Approved & Verified: App #${applicationNo} (${serviceName})`;
  const html = wrapTemplate(
    'Application Approved & Verified',
    `
      <div style="text-align:right;"><span class="badge badge-success">Approved</span></div>
      <h2 style="margin-top:0; color:#0f172a; font-size:20px; font-weight:800;">Hello ${shopOwnerName || 'Partner'}, 👋</h2>
      <p style="font-size:14px; color:#475569; line-height:1.6;">
        Great news! Your service application <strong>#${applicationNo}</strong> for <strong>${serviceName}</strong> has been <strong>APPROVED & VERIFIED</strong> by Administration.
      </p>

      <table class="table-info">
        <tr><td class="label">Application No</td><td class="value">#${applicationNo}</td></tr>
        <tr><td class="label">Service Name</td><td class="value">${serviceName}</td></tr>
        <tr><td class="label">Verification Status</td><td class="value" style="color:#16a34a; font-size:14px;">VERIFIED & CLOSED</td></tr>
      </table>

      <div class="box box-success">
        <p style="margin:0; font-size:12px; color:#166534;">
          You can now log into your <strong>Shop Dashboard -> Applied Services</strong> to view or print the verified output document.
        </p>
      </div>
    `
  );

  return sendEmail({ to: toEmail, subject, html });
};

/**
 * 17. Security Alert: Account Password Changed
 */
export const sendPasswordChangedEmail = async ({ toEmail, userName }) => {
  if (!toEmail) return;
  const subject = `🔒 Security Alert: Password Updated for V2Online Account`;
  const html = wrapTemplate(
    'Security Notification',
    `
      <div style="text-align:right;"><span class="badge badge-warning">Security Alert</span></div>
      <h2 style="margin-top:0; color:#0f172a; font-size:20px; font-weight:800;">Hello ${userName || 'User'}, 👋</h2>
      <p style="font-size:14px; color:#475569; line-height:1.6;">
        Your password for <strong>V2Online Portal</strong> was successfully changed.
      </p>

      <div class="box box-warning">
        <p style="margin:0; font-size:12px; color:#92400e; line-height:1.5;">
          <strong>⚠️ Security Notice:</strong> If you did not perform this action, please contact Portal Administration or Support immediately to secure your account.
        </p>
      </div>
    `
  );

  return sendEmail({ to: toEmail, subject, html });
};

