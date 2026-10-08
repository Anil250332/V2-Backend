import express from 'express';
import {
  getWalletTransactions,
  rechargeWallet,
  deductWallet,
  refundWallet,
  submitWithdrawal,
  getWithdrawals,
  processWithdrawal
} from '../controllers/walletController.js';
import { authenticateToken, authorizeRoles } from '../middlewares/authMiddleware.js';

const router = express.Router();

// General Wallet Operations
router.get('/transactions', authenticateToken, getWalletTransactions);
router.post('/recharge', authenticateToken, rechargeWallet);
router.post('/deduct', authenticateToken, deductWallet);

// Secured Refund Endpoint (Strictly Super Admin / Manager only)
router.post('/refund', authenticateToken, authorizeRoles('super_admin', 'manager'), refundWallet);

// Withdrawal / Payout Operations
router.post('/withdraw', authenticateToken, submitWithdrawal);
router.get('/withdrawals', authenticateToken, getWithdrawals);
router.patch('/withdrawals/:id/process', authenticateToken, authorizeRoles('super_admin', 'manager'), processWithdrawal);

export default router;
