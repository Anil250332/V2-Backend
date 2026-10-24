import express from 'express';
import {
  getWalletTransactions,
  rechargeWallet,
  deductWallet,
  refundWallet,
  submitWithdrawal,
  getWithdrawals,
  verifyWithdrawal,
  processWithdrawal
} from '../controllers/walletController.js';
import { authenticateToken, authorizeRoles } from '../middlewares/authMiddleware.js';

const router = express.Router();

// General Wallet Operations
router.get('/transactions', authenticateToken, getWalletTransactions);
router.post('/recharge', authenticateToken, rechargeWallet);
// Manual debit sirf Super Admin (service fee deduction /applications/apply me atomically hota hai)
router.post('/deduct', authenticateToken, authorizeRoles('super_admin'), deductWallet);

// Secured Refund Endpoint (Strictly Super Admin / Manager only)
router.post('/refund', authenticateToken, authorizeRoles('super_admin', 'manager'), refundWallet);

// Withdrawal / Payout Operations
// Withdrawal request sirf Operator / Distributor (project.md roles matrix)
router.post('/withdraw', authenticateToken, authorizeRoles('operator', 'distributor'), submitWithdrawal);
router.get('/withdrawals', authenticateToken, getWithdrawals);
// 2-Tier payout: Step 1 Manager verify -> Step 2 Admin final release (UTR)
router.patch('/withdrawals/:id/verify', authenticateToken, authorizeRoles('super_admin', 'sub_admin', 'manager'), verifyWithdrawal);
router.patch('/withdrawals/:id/process', authenticateToken, authorizeRoles('super_admin', 'sub_admin'), processWithdrawal);

export default router;
