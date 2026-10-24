import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';

dotenv.config();

// Security: hardcoded fallback secret nahi — bina JWT_SECRET ke koi bhi fake admin token bana sakta tha
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  throw new Error('JWT_SECRET environment variable is not set. Kripya backend/.env (local) ya server env (Render) me JWT_SECRET set karein.');
}
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '24h';

export const generateToken = (user) => {
  const payload = {
    id: user.id,
    uuid: user.uuid,
    role: user.role,
    mobile: user.mobile,
    full_name: user.full_name,
    shop_name: user.shop_name || null
  };

  return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
};

export const verifyToken = (token) => {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (error) {
    return null;
  }
};
