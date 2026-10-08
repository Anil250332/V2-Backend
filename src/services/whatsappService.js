/**
 * WhatsApp service disabled - System now uses 100% Email Notifications via Nodemailer.
 */
export const sendWhatsAppOtp = async (mobile, otp) => {
  return { success: true, mode: 'disabled' };
};

export const sendWhatsAppNotification = async (mobile, message) => {
  return { success: true, mode: 'disabled' };
};
