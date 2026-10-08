import pool from '../config/db.js';

/**
 * Application Repository
 * Handles direct MySQL queries for applications, documents, transactions, and wallets
 */
class ApplicationRepository {
  /**
   * Deduct agent wallet and create application record atomically
   */
  async createApplicationWithDeduction({
    agentId,
    subServiceId,
    operatorId,
    distributorId,
    customerName,
    customerMobile,
    district,
    tehsil,
    wardNo,
    formData,
    feeDeducted,
    operatorPayout,
    distributorPayout,
    serviceTitle,
    documents = []
  }) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      // 1. Lock and check Agent Wallet
      const [wallets] = await connection.query(
        'SELECT id, balance FROM wallets WHERE user_id = ? FOR UPDATE',
        [agentId]
      );

      if (wallets.length === 0) {
        throw new Error('Agent wallet not found.');
      }

      const walletId = wallets[0].id;
      const openingBalance = parseFloat(wallets[0].balance);

      if (openingBalance < feeDeducted) {
        throw new Error(`Insufficient wallet balance. Current: ₹${openingBalance.toFixed(2)}, Required: ₹${feeDeducted.toFixed(2)}`);
      }

      const closingBalance = openingBalance - feeDeducted;

      // 2. Deduct wallet balance
      await connection.query('UPDATE wallets SET balance = ? WHERE id = ?', [closingBalance, walletId]);

      // 3. Insert Application with temporary application_no
      const initialStatus = operatorId ? 'assigned' : 'pending';
      const [appRes] = await connection.query(
        `INSERT INTO applications (
          application_no, agent_id, sub_service_id, operator_id, distributor_id,
          customer_name, customer_mobile, district, tehsil, ward_no,
          form_data, status, fee_deducted, operator_payout, distributor_payout
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          'APP-TEMP',
          agentId,
          subServiceId,
          operatorId || null,
          distributorId || null,
          customerName,
          customerMobile,
          district,
          tehsil || null,
          wardNo || null,
          JSON.stringify(formData || {}),
          initialStatus,
          feeDeducted,
          operatorPayout,
          distributorPayout
        ]
      );

      const appId = appRes.insertId;
      const year = new Date().getFullYear();
      const applicationNo = `APP-${year}-${1000 + appId}`;

      // 4. Update application_no
      await connection.query('UPDATE applications SET application_no = ? WHERE id = ?', [applicationNo, appId]);

      // 5. Insert uploaded documents
      if (Array.isArray(documents) && documents.length > 0) {
        for (const doc of documents) {
          await connection.query(
            `INSERT INTO application_documents (
              application_id, doc_label, file_name, file_path, mime_type, file_size_kb
            ) VALUES (?, ?, ?, ?, ?, ?)`,
            [
              appId,
              doc.label,
              doc.fileName,
              doc.filePath,
              doc.mimeType || 'application/octet-stream',
              doc.fileSizeKb || 0
            ]
          );
        }
      }

      // 6. Record Wallet Transaction
      const [txnRes] = await connection.query(
        `INSERT INTO transactions (
          txn_no, wallet_id, user_id, application_id, type, category, amount,
          opening_balance, closing_balance, status, remarks
        ) VALUES (?, ?, ?, ?, 'debit', 'service_fee', ?, ?, ?, 'success', ?)`,
        [
          'TXN-TEMP',
          walletId,
          agentId,
          appId,
          feeDeducted,
          openingBalance,
          closingBalance,
          `Service Fee for ${serviceTitle} [App ID: ${applicationNo}]`
        ]
      );

      const txnNo = `TXN-${year}-${1000 + txnRes.insertId}`;
      await connection.query('UPDATE transactions SET txn_no = ? WHERE id = ?', [txnNo, txnRes.insertId]);

      await connection.commit();

      return {
        id: appId,
        applicationNo,
        status: initialStatus,
        feeDeducted,
        closingBalance,
        txnNo
      };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  /**
   * Get applications with filtering options and joins
   */
  async getApplications({ agentId, operatorId, status, limit = 100, offset = 0 } = {}) {
    let query = `
      SELECT 
        a.id,
        a.application_no as applicationNo,
        a.agent_id as agentId,
        a.sub_service_id as subServiceId,
        a.operator_id as operatorId,
        a.distributor_id as distributorId,
        a.customer_name as customerName,
        a.customer_mobile as customerMobile,
        a.district,
        a.tehsil,
        a.ward_no as wardNo,
        a.form_data as formData,
        a.status,
        a.rejection_reason as rejectionReason,
        a.correction_remarks as correctionRemarks,
        a.govt_ack_no as govtAckNo,
        a.completion_output_data as completionOutputData,
        a.fee_deducted as feeDeducted,
        a.operator_payout as operatorPayout,
        a.distributor_payout as distributorPayout,
        a.created_at as createdAt,
        a.accepted_at as acceptedAt,
        a.completed_at as completedAt,
        u_agent.full_name as agentName,
        u_agent.shop_name as shopName,
        u_agent.mobile as agentMobile,
        u_op.full_name as operatorName,
        u_op.mobile as operatorMobile,
        ss.name as subServiceName,
        ss.code as subServiceCode,
        ss.form_schema as subServiceFormSchema,
        COALESCE(s.name, ss.name, 'Service Application') as serviceName,
        COALESCE(s.code, ss.code, 'SRV') as serviceCode,
        s.form_schema as serviceFormSchema,
        s.icon_url as iconUrl
      FROM applications a
      JOIN users u_agent ON a.agent_id = u_agent.id
      LEFT JOIN users u_op ON a.operator_id = u_op.id
      LEFT JOIN sub_services ss ON a.sub_service_id = ss.id
      LEFT JOIN services s ON ss.service_id = s.id
      WHERE 1=1
    `;

    const params = [];

    if (agentId) {
      query += ' AND a.agent_id = ?';
      params.push(agentId);
    }
    if (operatorId) {
      query += ' AND a.operator_id = ?';
      params.push(operatorId);
    }
    if (status) {
      if (Array.isArray(status)) {
        query += ` AND a.status IN (${status.map(() => '?').join(',')})`;
        params.push(...status);
      } else {
        query += ' AND a.status = ?';
        params.push(status);
      }
    }

    query += ' ORDER BY a.created_at DESC LIMIT ? OFFSET ?';
    params.push(Number(limit), Number(offset));

    const [rows] = await pool.query(query, params);

    // Fetch documents for returned applications
    if (rows.length > 0) {
      const appIds = rows.map(r => r.id);
      const [docs] = await pool.query(
        'SELECT application_id, doc_label, file_name, file_path, mime_type, file_size_kb FROM application_documents WHERE application_id IN (?)',
        [appIds]
      );

      const docsMap = {};
      docs.forEach(d => {
        if (!docsMap[d.application_id]) docsMap[d.application_id] = [];
        docsMap[d.application_id].push({
          label: d.doc_label,
          fileName: d.file_name,
          filePath: d.file_path,
          mimeType: d.mime_type,
          fileSizeKb: d.file_size_kb
        });
      });

      return rows.map(r => ({
        ...r,
        documents: docsMap[r.id] || []
      }));
    }

    return [];
  }

  /**
   * Get single application by ID
   */
  async getApplicationById(id) {
    const list = await this.getApplications({ limit: 1 });
    const [rows] = await pool.query(
      `SELECT 
        a.*,
        u_agent.full_name as agentName,
        u_agent.shop_name as shopName,
        u_agent.mobile as agentMobile,
        u_op.full_name as operatorName,
        u_op.mobile as operatorMobile,
        ss.name as subServiceName,
        ss.code as subServiceCode,
        ss.form_schema as subServiceFormSchema,
        s.name as serviceName,
        s.code as serviceCode,
        s.form_schema as serviceFormSchema,
        s.icon_url as iconUrl
      FROM applications a
      JOIN users u_agent ON a.agent_id = u_agent.id
      LEFT JOIN users u_op ON a.operator_id = u_op.id
      JOIN sub_services ss ON a.sub_service_id = ss.id
      JOIN services s ON ss.service_id = s.id
      WHERE a.id = ? OR a.application_no = ?
      LIMIT 1`,
      [id, id]
    );

    if (rows.length === 0) return null;

    const [docs] = await pool.query(
      'SELECT doc_label, file_name, file_path, mime_type, file_size_kb FROM application_documents WHERE application_id = ?',
      [rows[0].id]
    );

    return {
      ...rows[0],
      documents: docs
    };
  }

  /**
   * Operator marks application completed with output reference & deliverable files
   */
  async completeApplication({ appId, operatorId, govtAckNo, outputNote, outputFiles = [] }) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      const outputData = {
        note: outputNote || 'Work completed successfully',
        completedAt: new Date().toISOString(),
        files: outputFiles
      };

      await connection.query(
        `UPDATE applications 
         SET status = 'completed',
             operator_id = COALESCE(operator_id, ?),
             govt_ack_no = ?,
             completion_output_data = ?,
             completed_at = NOW()
         WHERE id = ? AND (operator_id = ? OR operator_id IS NULL)`,
        [operatorId || null, govtAckNo || null, JSON.stringify(outputData), appId, operatorId]
      );

      // Insert deliverable document records
      if (Array.isArray(outputFiles) && outputFiles.length > 0) {
        for (const f of outputFiles) {
          await connection.query(
            `INSERT INTO application_documents (
              application_id, doc_label, file_name, file_path, mime_type, file_size_kb
            ) VALUES (?, ?, ?, ?, ?, ?)`,
            [
              appId,
              f.label || 'Deliverable Output Certificate',
              f.fileName,
              f.filePath,
              f.mimeType || 'application/pdf',
              f.fileSizeKb || 0
            ]
          );
        }
      }

      await connection.commit();
      return true;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  /**
   * Admin / Manager verifies completed task -> Credits Operator Wallet atomically
   */
  async verifyAndCreditOperatorWallet({ appId, verifierId }) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      // 1. Fetch application details
      const [apps] = await connection.query(
        `SELECT id, application_no, operator_id, operator_payout, status, sub_service_id, distributor_id, distributor_payout
         FROM applications WHERE id = ? FOR UPDATE`,
        [appId]
      );

      if (apps.length === 0) throw new Error('Application not found.');
      const app = apps[0];

      if (app.status === 'verified') {
        throw new Error('This application has already been verified and operator payout was credited.');
      }

      const opId = app.operator_id;
      const opPayout = parseFloat(app.operator_payout || 0);

      // 2. Update application status to 'verified'
      await connection.query(
        "UPDATE applications SET status = 'verified' WHERE id = ?",
        [appId]
      );

      // 3. Credit Operator Wallet if operator exists and payout > 0
      if (opId && opPayout > 0) {
        const [opWallets] = await connection.query(
          'SELECT id, balance FROM wallets WHERE user_id = ? FOR UPDATE',
          [opId]
        );

        let walletId;
        let opOpening = 0.00;

        if (opWallets.length === 0) {
          const [wIns] = await connection.query('INSERT INTO wallets (user_id, balance) VALUES (?, 0.00)', [opId]);
          walletId = wIns.insertId;
        } else {
          walletId = opWallets[0].id;
          opOpening = parseFloat(opWallets[0].balance);
        }

        const opClosing = opOpening + opPayout;
        await connection.query('UPDATE wallets SET balance = ? WHERE id = ?', [opClosing, walletId]);

        // Record earning transaction
        const year = new Date().getFullYear();
        const [txnRes] = await connection.query(
          `INSERT INTO transactions (
            txn_no, wallet_id, user_id, application_id, type, category, amount,
            opening_balance, closing_balance, status, remarks
          ) VALUES (?, ?, ?, ?, 'credit', 'operator_earning', ?, ?, ?, 'success', ?)`,
          [
            'TXN-TEMP',
            walletId,
            opId,
            appId,
            opPayout,
            opOpening,
            opClosing,
            `Operator Share credited for Application [App ID: ${app.application_no}]`
          ]
        );

        const txnNo = `TXN-${year}-${1000 + txnRes.insertId}`;
        await connection.query('UPDATE transactions SET txn_no = ? WHERE id = ?', [txnNo, txnRes.insertId]);
      }

      await connection.commit();
      return true;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  /**
   * Reject application -> Auto-refund agent wallet atomically
   */
  async rejectAndRefundAgentWallet({ appId, reason, rejectedBy }) {
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      // 1. Fetch application details
      const [apps] = await connection.query(
        `SELECT id, application_no, agent_id, fee_deducted, status FROM applications WHERE id = ? FOR UPDATE`,
        [appId]
      );

      if (apps.length === 0) throw new Error('Application not found.');
      const app = apps[0];

      if (app.status === 'rejected') {
        throw new Error('Application is already rejected.');
      }

      // 2. Mark application rejected
      await connection.query(
        "UPDATE applications SET status = 'rejected', rejection_reason = ? WHERE id = ?",
        [reason || 'Rejected by Verifier / Operator', appId]
      );

      // 3. Refund Agent Wallet
      const agentId = app.agent_id;
      const refundAmt = parseFloat(app.fee_deducted);

      if (refundAmt > 0) {
        const [wallets] = await connection.query(
          'SELECT id, balance FROM wallets WHERE user_id = ? FOR UPDATE',
          [agentId]
        );

        let walletId;
        let opening = 0.00;

        if (wallets.length === 0) {
          const [wIns] = await connection.query('INSERT INTO wallets (user_id, balance) VALUES (?, 0.00)', [agentId]);
          walletId = wIns.insertId;
        } else {
          walletId = wallets[0].id;
          opening = parseFloat(wallets[0].balance);
        }

        const closing = opening + refundAmt;
        await connection.query('UPDATE wallets SET balance = ? WHERE id = ?', [closing, walletId]);

        const year = new Date().getFullYear();
        const [txnRes] = await connection.query(
          `INSERT INTO transactions (
            txn_no, wallet_id, user_id, application_id, type, category, amount,
            opening_balance, closing_balance, status, remarks
          ) VALUES (?, ?, ?, ?, 'credit', 'refund', ?, ?, ?, 'success', ?)`,
          [
            'TXN-TEMP',
            walletId,
            agentId,
            appId,
            refundAmt,
            opening,
            closing,
            `Refund for Rejected Application [App ID: ${app.application_no}]: ${reason || 'Application Rejected'}`
          ]
        );

        const txnNo = `TXN-${year}-${1000 + txnRes.insertId}`;
        await connection.query('UPDATE transactions SET txn_no = ? WHERE id = ?', [txnNo, txnRes.insertId]);
      }

      await connection.commit();
      return true;
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }
}

export const applicationRepository = new ApplicationRepository();
export default applicationRepository;
