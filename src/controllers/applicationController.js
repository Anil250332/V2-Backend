import applicationService from '../services/applicationService.js';

/**
 * Application Controller
 * Handles HTTP requests, validations, and file upload parsing
 */

/**
 * 1. Apply for a Service (Agent)
 * POST /api/applications/apply
 */
export const applyService = async (req, res) => {
  try {
    const agent = req.user;
    if (!agent || agent.role !== 'agent') {
      return res.status(403).json({ status: 'error', message: 'Only registered MP Online Agents can apply for services.' });
    }

    const {
      subServiceId,
      sub_service_id,
      serviceId,
      service_id,
      areaLabel,
      area_label,
      wardNo,
      ward_no
    } = req.body;

    // Parse JSON formData if passed as string in multipart
    let formData = {};
    if (req.body.formData) {
      if (typeof req.body.formData === 'string') {
        try {
          formData = JSON.parse(req.body.formData);
        } catch {
          formData = {};
        }
      } else {
        formData = req.body.formData;
      }
    }

    // Process uploaded document files
    const uploadedDocs = [];
    if (req.files && Array.isArray(req.files)) {
      req.files.forEach(file => {
        const label = file.fieldname.startsWith('doc_')
          ? file.fieldname.replace('doc_', '')
          : file.fieldname;

        uploadedDocs.push({
          label: label || 'Uploaded Document',
          fileName: file.originalname,
          filePath: `/uploads/applications/${file.filename}`,
          mimeType: file.mimetype,
          fileSizeKb: Math.round(file.size / 1024)
        });
      });
    }

    const result = await applicationService.applyService({
      agent,
      subServiceId: subServiceId || sub_service_id,
      serviceId: serviceId || service_id,
      formData,
      files: uploadedDocs,
      areaLabel: areaLabel || area_label,
      wardNo: wardNo || ward_no
    });

    return res.status(201).json({
      status: 'success',
      message: `Application "${result.applicationNo}" submitted successfully! Service fee ₹${result.feeDeducted.toFixed(2)} deducted.`,
      data: result
    });
  } catch (error) {
    console.error('Apply Service Error:', error);
    return res.status(500).json({ status: 'error', message: error.message || 'Failed to submit service application.' });
  }
};

/**
 * 2. Get Agent's My Applications
 * GET /api/applications/my-requests
 */
export const getMyApplications = async (req, res) => {
  try {
    const agentId = req.user?.id;
    const { status } = req.query;

    const applications = await applicationService.getAgentApplications(agentId, { status });

    return res.status(200).json({
      status: 'success',
      data: applications
    });
  } catch (error) {
    console.error('Get My Applications Error:', error);
    return res.status(500).json({ status: 'error', message: error.message });
  }
};

/**
 * 3. Get Operator's Work Queue
 * GET /api/applications/operator-queue
 */
export const getOperatorQueue = async (req, res) => {
  try {
    const operatorId = req.user?.id;
    const { status } = req.query;

    const queue = await applicationService.getOperatorQueue(operatorId, { status });

    return res.status(200).json({
      status: 'success',
      data: queue
    });
  } catch (error) {
    console.error('Get Operator Queue Error:', error);
    return res.status(500).json({ status: 'error', message: error.message });
  }
};

/**
 * 4. Get Admin / Manager Verification Queue
 * GET /api/applications/verification-queue
 */
export const getVerificationQueue = async (req, res) => {
  try {
    const list = await applicationService.getVerificationQueue();
    return res.status(200).json({
      status: 'success',
      data: list
    });
  } catch (error) {
    console.error('Get Verification Queue Error:', error);
    return res.status(500).json({ status: 'error', message: error.message });
  }
};

/**
 * 5. Get Application Details by ID
 * GET /api/applications/:id
 */
export const getApplicationDetails = async (req, res) => {
  try {
    const { id } = req.params;
    const app = await applicationService.getApplicationDetails(id);
    return res.status(200).json({
      status: 'success',
      data: app
    });
  } catch (error) {
    console.error('Get Application Details Error:', error);
    return res.status(404).json({ status: 'error', message: error.message });
  }
};

/**
 * 6. Operator Completes Application (Uploads Certificate / Deliverables)
 * POST /api/applications/:id/complete
 */
export const completeApplication = async (req, res) => {
  try {
    const { id } = req.params;
    const operatorId = req.user?.id;
    const { govtAckNo, govt_ack_no, outputNote, output_note } = req.body;

    const deliverableDocs = [];
    if (req.files && Array.isArray(req.files)) {
      req.files.forEach(file => {
        deliverableDocs.push({
          label: file.fieldname.startsWith('deliverable_')
            ? file.fieldname.replace('deliverable_', '')
            : 'Deliverable Output Certificate',
          fileName: file.originalname,
          filePath: `/uploads/applications/${file.filename}`,
          mimeType: file.mimetype,
          fileSizeKb: Math.round(file.size / 1024)
        });
      });
    }

    await applicationService.completeApplication({
      appId: id,
      operatorId,
      govtAckNo: govtAckNo || govt_ack_no,
      outputNote: outputNote || output_note,
      outputFiles: deliverableDocs
    });

    return res.status(200).json({
      status: 'success',
      message: 'Application marked completed and deliverable files uploaded successfully! Sent for verification.'
    });
  } catch (error) {
    console.error('Complete Application Error:', error);
    return res.status(500).json({ status: 'error', message: error.message });
  }
};

/**
 * 7. Admin / Manager Verifies Application -> Credits Operator Wallet
 * PATCH /api/applications/:id/verify
 */
export const verifyApplication = async (req, res) => {
  try {
    const { id } = req.params;
    const verifierId = req.user?.id;

    await applicationService.verifyApplication({ appId: id, verifierId });

    return res.status(200).json({
      status: 'success',
      message: 'Application verified successfully! Operator earning has been credited to their wallet.'
    });
  } catch (error) {
    console.error('Verify Application Error:', error);
    return res.status(500).json({ status: 'error', message: error.message });
  }
};

/**
 * 8. Reject Application -> Auto-Refunds Agent Wallet
 * PATCH /api/applications/:id/reject
 */
export const rejectApplication = async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    const rejectedBy = req.user?.id;

    await applicationService.rejectApplication({ appId: id, reason, rejectedBy });

    return res.status(200).json({
      status: 'success',
      message: 'Application rejected. Service fee has been automatically refunded to the Agent wallet.'
    });
  } catch (error) {
    console.error('Reject Application Error:', error);
    return res.status(500).json({ status: 'error', message: error.message });
  }
};
