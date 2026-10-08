import pool from '../config/db.js';
import { sendWalletCreditEmail, sendWithdrawalRequestAlertToAdmin, sendWithdrawalStatusEmail } from '../utils/mailer.js';

/**
 * 1. Get Wallet Balance and Transaction Ledger
 * GET /api/wallet/transactions
 */
export const getWalletTransactions = async (req, res) => {
  try {
    const userId = req.user?.id;
    const userRole = req.user?.role || 'agent';

    let query = `
      SELECT t.id, t.txn_no as txnNo, t.type, t.category, t.amount,
             t.opening_balance as openingBalance, t.closing_balance as closingBalance,
             t.remarks, t.status, t.created_at as createdAt,
             u.full_name as userName, u.shop_name as shopName, u.mobile as userMobile, u.role as userRole
      FROM transactions t
      LEFT JOIN users u ON t.user_id = u.id
    `;

    const params = [];
    if (userRole !== 'super_admin' && userRole !== 'manager' && userId) {
      query += ' WHERE t.user_id = ?';
      params.push(userId);
    }

    query += ' ORDER BY t.created_at DESC';

    const [rows] = await pool.query(query, params);

    // Fetch current user wallet balance
    let balance = 0.00;
    if (userId) {
      const [wRows] = await pool.query('SELECT balance FROM wallets WHERE user_id = ?', [userId]);
      if (wRows.length > 0) {
        balance = parseFloat(wRows[0].balance);
      }
    }

    const formattedTxns = rows.map(r => ({
      id: r.id.toString(),
      txnNo: r.txnNo,
      type: r.type.toUpperCase(),
      category: r.category,
      amount: parseFloat(r.amount),
      openingBalance: parseFloat(r.openingBalance),
      closingBalance: parseFloat(r.closingBalance),
      remarks: r.remarks,
      status: r.status.toUpperCase(),
      userName: r.userName || 'Shop Retailer',
      shopName: r.shopName || r.userName || 'MP Online Center',
      userMobile: r.userMobile || 'N/A',
      userRole: r.userRole || 'agent',
      createdAt: new Date(r.createdAt).toLocaleString('en-IN', {
        day: '2-digit', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit', hour12: true
      })
    }));

    return res.status(200).json({
      status: 'success',
      balance,
      data: formattedTxns
    });
  } catch (error) {
    console.error('Get Wallet Transactions Error:', error);
    return res.status(500).json({ status: 'error', message: error.message });
  }
};

/**
 * 2. Recharge Wallet (Add Money)
 * POST /api/wallet/recharge
 */
export const rechargeWallet = async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const userId = req.user?.id || 1;
    const { amount, remarks } = req.body;
    const rechargeAmt = parseFloat(amount);

    if (isNaN(rechargeAmt) || rechargeAmt <= 0) {
      return res.status(400).json({ status: 'error', message: 'Kripya sahi recharge amount enter karein.' });
    }

    await connection.beginTransaction();

    // Fetch current wallet
    const [wallets] = await connection.query('SELECT id, balance FROM wallets WHERE user_id = ? FOR UPDATE', [userId]);
    let walletId;
    let openingBalance = 0.00;

    if (wallets.length === 0) {
      const [wRes] = await connection.query('INSERT INTO wallets (user_id, balance) VALUES (?, 0.00)', [userId]);
      walletId = wRes.insertId;
    } else {
      walletId = wallets[0].id;
      openingBalance = parseFloat(wallets[0].balance);
    }

    const closingBalance = openingBalance + rechargeAmt;

    // Update Wallet Balance
    await connection.query('UPDATE wallets SET balance = ? WHERE id = ?', [closingBalance, walletId]);

    // Insert dummy transaction first to get insertId for TXN-2026-XXXX format
    const gatewayTxnId = `UPI-${Date.now()}`;
    const [txnRes] = await connection.query(
      `INSERT INTO transactions (
        txn_no, wallet_id, user_id, type, category, amount,
        opening_balance, closing_balance, gateway_txn_id, status, remarks
      ) VALUES (?, ?, ?, 'credit', 'topup', ?, ?, ?, ?, 'success', ?)`,
      ['TXN-TEMP', walletId, userId, rechargeAmt, openingBalance, closingBalance, gatewayTxnId, remarks || 'Wallet Topup via Auto UPI / Payment Gateway']
    );

    const year = new Date().getFullYear();
    const txnNo = `TXN-${year}-${1000 + txnRes.insertId}`;
    await connection.query('UPDATE transactions SET txn_no = ? WHERE id = ?', [txnNo, txnRes.insertId]);

    await connection.commit();

    // Send Wallet Credit Email to Shop Agent ONLY (non-blocking)
    if (req.user?.email) {
      sendWalletCreditEmail({
        toEmail: req.user.email,
        shopName: req.user.shop_name || req.user.full_name,
        amount: rechargeAmt,
        newBalance: closingBalance,
        txnId: txnNo
      }).catch(err => console.error('Recharge credit email error:', err.message));
    }

    return res.status(200).json({
      status: 'success',
      message: `₹${rechargeAmt.toFixed(2)} wallet me add kar diye gaye hain!`,
      data: {
        txnNo,
        amount: rechargeAmt,
        closingBalance,
        createdAt: new Date().toLocaleString()
      }
    });
  } catch (error) {
    await connection.rollback();
    console.error('Recharge Wallet Error:', error);
    return res.status(500).json({ status: 'error', message: error.message });
  } finally {
    connection.release();
  }
};

/**
 * 3. Deduct Wallet Balance for Service
 * POST /api/wallet/deduct
 */
export const deductWallet = async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const userId = req.user?.id || 1;
    const { amount, serviceName, appId } = req.body;
    const deductAmt = parseFloat(amount);

    if (isNaN(deductAmt) || deductAmt <= 0) {
      return res.status(400).json({ status: 'error', message: 'Invalid deduction amount.' });
    }

    await connection.beginTransaction();

    const [wallets] = await connection.query('SELECT id, balance FROM wallets WHERE user_id = ? FOR UPDATE', [userId]);
    if (wallets.length === 0) {
      await connection.rollback();
      return res.status(400).json({ status: 'error', message: 'Wallet not found.' });
    }

    const walletId = wallets[0].id;
    const openingBalance = parseFloat(wallets[0].balance);

    if (openingBalance < deductAmt) {
      await connection.rollback();
      return res.status(400).json({
        status: 'error',
        message: `Insufficient wallet balance! Current balance is ₹${openingBalance.toFixed(2)}, required ₹${deductAmt.toFixed(2)}. Kripya wallet recharge karein.`
      });
    }

    const closingBalance = openingBalance - deductAmt;

    // Update Wallet Balance
    await connection.query('UPDATE wallets SET balance = ? WHERE id = ?', [closingBalance, walletId]);

    const remarksText = appId
      ? `Service Fee for ${serviceName || 'Application'} [App ID: ${appId}]`
      : `Service Fee for ${serviceName || 'Application'}`;

    const [txnRes] = await connection.query(
      `INSERT INTO transactions (
        txn_no, wallet_id, user_id, type, category, amount,
        opening_balance, closing_balance, status, remarks
      ) VALUES (?, ?, ?, 'debit', 'service_fee', ?, ?, ?, 'success', ?)`,
      ['TXN-TEMP', walletId, userId, deductAmt, openingBalance, closingBalance, remarksText]
    );

    const year = new Date().getFullYear();
    const txnNo = `TXN-${year}-${1000 + txnRes.insertId}`;
    await connection.query('UPDATE transactions SET txn_no = ? WHERE id = ?', [txnNo, txnRes.insertId]);

    await connection.commit();

    return res.status(200).json({
      status: 'success',
      message: `₹${deductAmt.toFixed(2)} service fee deduct kar li gayi hai!`,
      data: {
        txnNo,
        amount: deductAmt,
        closingBalance,
        appId
      }
    });
  } catch (error) {
    await connection.rollback();
    console.error('Deduct Wallet Error:', error);
    return res.status(500).json({ status: 'error', message: error.message });
  } finally {
    connection.release();
  }
};

/**
 * 4. Refund Wallet Balance for Rejected Service Application
 * POST /api/wallet/refund
 */
export const refundWallet = async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const { userId, amount, serviceName, appId, remarks } = req.body;
    const targetUserId = userId || req.user?.id;
    const refundAmt = parseFloat(amount);

    if (!targetUserId) {
      return res.status(400).json({ status: 'error', message: 'Target user ID is required for refund.' });
    }

    if (isNaN(refundAmt) || refundAmt <= 0) {
      return res.status(400).json({ status: 'error', message: 'Invalid refund amount.' });
    }

    await connection.beginTransaction();

    const [wallets] = await connection.query('SELECT id, balance FROM wallets WHERE user_id = ? FOR UPDATE', [targetUserId]);
    let walletId;
    let openingBalance = 0.00;

    if (wallets.length === 0) {
      const [wRes] = await connection.query('INSERT INTO wallets (user_id, balance) VALUES (?, 0.00)', [targetUserId]);
      walletId = wRes.insertId;
    } else {
      walletId = wallets[0].id;
      openingBalance = parseFloat(wallets[0].balance);
    }

    const closingBalance = openingBalance + refundAmt;

    // Update Wallet Balance
    await connection.query('UPDATE wallets SET balance = ? WHERE id = ?', [closingBalance, walletId]);

    const remarksText = `Refund for Rejected Service: ${serviceName || 'Application'}${appId ? ` [App ID: ${appId}]` : ''}${remarks ? ` - Reason: ${remarks}` : ''}`;

    const [txnRes] = await connection.query(
      `INSERT INTO transactions (
        txn_no, wallet_id, user_id, type, category, amount,
        opening_balance, closing_balance, status, remarks
      ) VALUES (?, ?, ?, 'credit', 'refund', ?, ?, ?, 'success', ?)`,
      ['TXN-TEMP', walletId, targetUserId, refundAmt, openingBalance, closingBalance, remarksText]
    );

    const year = new Date().getFullYear();
    const txnNo = `TXN-${year}-${1000 + txnRes.insertId}`;
    await connection.query('UPDATE transactions SET txn_no = ? WHERE id = ?', [txnNo, txnRes.insertId]);

    await connection.commit();

    return res.status(200).json({
      status: 'success',
      message: `₹${refundAmt.toFixed(2)} refund successfully credited back to wallet!`,
      data: {
        txnNo,
        amount: refundAmt,
        closingBalance,
        appId
      }
    });
  } catch (error) {
    await connection.rollback();
    console.error('Refund Wallet Error:', error);
    return res.status(500).json({ status: 'error', message: error.message });
  } finally {
    connection.release();
  }
};

/**
 * 5. Submit Payout / Withdrawal Request (Operator / Agent)
 * POST /api/wallet/withdraw
 */
export const submitWithdrawal = async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const userId = req.user?.id;
    const { amount, paymentMode = 'bank_transfer', accountHolderName, bankName, accountNo, ifscCode, upiId } = req.body;
    const withdrawAmt = parseFloat(amount);

    if (!userId) {
      return res.status(401).json({ status: 'error', message: 'Unauthorized session.' });
    }

    if (isNaN(withdrawAmt) || withdrawAmt <= 0) {
      return res.status(400).json({ status: 'error', message: 'Valid withdrawal amount is required.' });
    }

    if (!accountHolderName) {
      return res.status(400).json({ status: 'error', message: 'Account Holder Name is required.' });
    }

    await connection.beginTransaction();

    // Check user wallet balance
    const [wallets] = await connection.query('SELECT id, balance FROM wallets WHERE user_id = ? FOR UPDATE', [userId]);
    if (wallets.length === 0 || parseFloat(wallets[0].balance) < withdrawAmt) {
      await connection.rollback();
      const current = wallets.length > 0 ? parseFloat(wallets[0].balance) : 0;
      return res.status(400).json({
        status: 'error',
        message: `Insufficient balance! Current: ₹${current.toFixed(2)}, Requested: ₹${withdrawAmt.toFixed(2)}`
      });
    }

    const walletId = wallets[0].id;
    const openingBalance = parseFloat(wallets[0].balance);
    const closingBalance = openingBalance - withdrawAmt;

    // Deduct balance from wallet
    await connection.query('UPDATE wallets SET balance = ? WHERE id = ?', [closingBalance, walletId]);

    // Insert withdrawal request
    const [reqRes] = await connection.query(
      `INSERT INTO withdrawal_requests (
        req_no, user_id, amount, payment_mode, account_holder_name,
        bank_name, account_no, ifsc_code, upi_id, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
      [
        'WDR-TEMP',
        userId,
        withdrawAmt,
        paymentMode,
        accountHolderName,
        bankName || null,
        accountNo || null,
        ifscCode || null,
        upiId || null
      ]
    );

    const year = new Date().getFullYear();
    const reqNo = `WDR-${year}-${1000 + reqRes.insertId}`;
    await connection.query('UPDATE withdrawal_requests SET req_no = ? WHERE id = ?', [reqNo, reqRes.insertId]);

    // Record debit transaction
    const [txnRes] = await connection.query(
      `INSERT INTO transactions (
        txn_no, wallet_id, user_id, type, category, amount,
        opening_balance, closing_balance, status, remarks
      ) VALUES (?, ?, ?, 'debit', 'withdrawal', ?, ?, ?, 'success', ?)`,
      [
        'TXN-TEMP',
        walletId,
        userId,
        withdrawAmt,
        openingBalance,
        closingBalance,
        `Payout Withdrawal Request [Req ID: ${reqNo}]`
      ]
    );

    const txnNo = `TXN-${year}-${1000 + txnRes.insertId}`;
    await connection.query('UPDATE transactions SET txn_no = ? WHERE id = ?', [txnNo, txnRes.insertId]);

    await connection.commit();

    // Notify Admin about Operator withdrawal request (non-blocking)
    sendWithdrawalRequestAlertToAdmin({
      operatorName: req.user?.full_name || accountHolderName,
      amount: withdrawAmt,
      paymentMethod: paymentMode,
      upiId: upiId || accountNo || 'N/A'
    }).catch(err => console.error('Withdrawal alert to admin email error:', err.message));

    return res.status(201).json({
      status: 'success',
      message: `Withdrawal request for ₹${withdrawAmt.toFixed(2)} submitted successfully!`,
      data: { reqNo, amount: withdrawAmt, closingBalance }
    });
  } catch (error) {
    await connection.rollback();
    console.error('Submit Withdrawal Error:', error);
    return res.status(500).json({ status: 'error', message: error.message });
  } finally {
    connection.release();
  }
};

/**
 * 6. Get Withdrawal Requests List
 * GET /api/wallet/withdrawals
 */
export const getWithdrawals = async (req, res) => {
  try {
    const userId = req.user?.id;
    const userRole = req.user?.role;

    let query = `
      SELECT w.*, u.full_name as userName, u.mobile as userMobile, u.role as userRole
      FROM withdrawal_requests w
      JOIN users u ON w.user_id = u.id
    `;

    const params = [];
    if (userRole !== 'super_admin' && userRole !== 'sub_admin' && userRole !== 'manager' && userId) {
      query += ' WHERE w.user_id = ?';
      params.push(userId);
    }

    query += ' ORDER BY w.created_at DESC';

    const [rows] = await pool.query(query, params);

    return res.status(200).json({
      status: 'success',
      data: rows.map(r => ({
        id: r.id.toString(),
        reqNo: r.req_no,
        userId: r.user_id.toString(),
        userName: r.userName,
        userMobile: r.userMobile,
        userRole: r.userRole,
        amount: parseFloat(r.amount),
        paymentMode: r.payment_mode,
        accountHolderName: r.account_holder_name,
        bankName: r.bank_name || 'N/A',
        accountNo: r.account_no || 'N/A',
        ifscCode: r.ifsc_code || 'N/A',
        upiId: r.upi_id || 'N/A',
        status: r.status.toUpperCase(),
        rejectionReason: r.rejection_reason || null,
        utrNo: r.utr_no || null,
        createdAt: new Date(r.created_at).toLocaleString('en-IN', {
          day: '2-digit', month: 'short', year: 'numeric',
          hour: '2-digit', minute: '2-digit', hour12: true
        })
      }))
    });
  } catch (error) {
    console.error('Get Withdrawals Error:', error);
    return res.status(500).json({ status: 'error', message: error.message });
  }
};

/**
 * 7. Process Withdrawal Request (Approve / Reject) (Admin / Manager)
 * PATCH /api/wallet/withdrawals/:id/process
 */
export const processWithdrawal = async (req, res) => {
  const connection = await pool.getConnection();
  try {
    const { id } = req.params;
    const { action, utrNo, rejectionReason } = req.body; // action: 'approve' | 'reject'
    const processedBy = req.user?.id || 1;

    if (!['approve', 'reject'].includes(action)) {
      return res.status(400).json({ status: 'error', message: 'Action must be "approve" or "reject".' });
    }

    await connection.beginTransaction();

    const [rows] = await connection.query('SELECT * FROM withdrawal_requests WHERE id = ? FOR UPDATE', [id]);
    if (rows.length === 0) {
      await connection.rollback();
      return res.status(404).json({ status: 'error', message: 'Withdrawal request not found.' });
    }

    const reqItem = rows[0];
    if (reqItem.status !== 'pending') {
      await connection.rollback();
      return res.status(400).json({ status: 'error', message: `Withdrawal request is already ${reqItem.status}.` });
    }

    if (action === 'approve') {
      await connection.query(
        `UPDATE withdrawal_requests 
         SET status = 'processed', utr_no = ?, processed_by = ?, processed_at = NOW() 
         WHERE id = ?`,
        [utrNo || 'BANK_SETTLED', processedBy, id]
      );
    } else {
      // Reject withdrawal -> Refund money back to user wallet
      const refundAmt = parseFloat(reqItem.amount);
      const targetUserId = reqItem.user_id;

      const [wallets] = await connection.query('SELECT id, balance FROM wallets WHERE user_id = ? FOR UPDATE', [targetUserId]);
      if (wallets.length > 0) {
        const walletId = wallets[0].id;
        const opening = parseFloat(wallets[0].balance);
        const closing = opening + refundAmt;

        await connection.query('UPDATE wallets SET balance = ? WHERE id = ?', [closing, walletId]);

        const year = new Date().getFullYear();
        const [txnRes] = await connection.query(
          `INSERT INTO transactions (
            txn_no, wallet_id, user_id, type, category, amount,
            opening_balance, closing_balance, status, remarks
          ) VALUES (?, ?, ?, 'credit', 'refund', ?, ?, ?, 'success', ?)`,
          [
            'TXN-TEMP',
            walletId,
            targetUserId,
            refundAmt,
            opening,
            closing,
            `Refund: Rejected Withdrawal Request [${reqItem.req_no}]: ${rejectionReason || 'Rejected by Admin'}`
          ]
        );

        const txnNo = `TXN-${year}-${1000 + txnRes.insertId}`;
        await connection.query('UPDATE transactions SET txn_no = ? WHERE id = ?', [txnNo, txnRes.insertId]);
      }

      await connection.query(
        `UPDATE withdrawal_requests 
         SET status = 'rejected', rejection_reason = ?, processed_by = ?, processed_at = NOW() 
         WHERE id = ?`,
        [rejectionReason || 'Rejected by Admin', processedBy, id]
      );
    }

    await connection.commit();

    // Send Withdrawal Status Email to Operator/User (non-blocking)
    pool.query('SELECT full_name, email FROM users WHERE id = ?', [reqItem.user_id])
      .then(([uRows]) => {
        if (uRows.length > 0 && uRows[0].email) {
          sendWithdrawalStatusEmail({
            toEmail: uRows[0].email,
            operatorName: uRows[0].full_name,
            amount: reqItem.amount,
            status: action === 'approve' ? 'approved' : 'rejected',
            note: action === 'approve' ? `UTR / Ref: ${utrNo || 'BANK_SETTLED'}` : rejectionReason
          }).catch(err => console.error('Withdrawal status email error:', err.message));
        }
      })
      .catch(err => console.error('Fetch user for withdrawal email error:', err.message));

    return res.status(200).json({
      status: 'success',
      message: `Withdrawal request ${action === 'approve' ? 'approved & marked processed' : 'rejected and amount refunded to wallet'}.`
    });
  } catch (error) {
    await connection.rollback();
    console.error('Process Withdrawal Error:', error);
    return res.status(500).json({ status: 'error', message: error.message });
  } finally {
    connection.release();
  }
};


