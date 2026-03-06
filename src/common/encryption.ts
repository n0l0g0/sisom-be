
import * as crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';

// We should use a proper key management system, but for now we'll derive it.
// The key must be 32 bytes for AES-256.
function getKey(): Buffer {
  const secret = process.env.ENCRYPTION_KEY || 'default-secret-key-please-change-in-production';
  return crypto.createHash('sha256').update(secret).digest();
}

export function encrypt(text: string): string {
  if (!text) return text;
  
  const key = getKey();
  const iv = crypto.randomBytes(12); // GCM standard IV size is 12 bytes
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  
  const authTag = cipher.getAuthTag().toString('hex');
  
  // Format: iv:authTag:encrypted
  return `${iv.toString('hex')}:${authTag}:${encrypted}`;
}

export function decrypt(text: string): string {
  if (!text) return text;
  
  // Check if text is in encrypted format (iv:authTag:encrypted)
  // IV (12 bytes) -> 24 hex chars
  // AuthTag (16 bytes) -> 32 hex chars
  const parts = text.split(':');
  if (parts.length !== 3) {
    // If not encrypted format, return as is (useful for migration or mixed data)
    return text;
  }
  
  try {
    const [ivHex, authTagHex, encryptedHex] = parts;
    const key = getKey();
    
    const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(ivHex, 'hex'));
    decipher.setAuthTag(Buffer.from(authTagHex, 'hex'));
    
    let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  } catch (error) {
    // If decryption fails (e.g. key mismatch or corrupted data), return original text or empty string?
    // Returning original text might be safer if it wasn't actually encrypted but just happened to have colons.
    console.error('Decryption failed:', error);
    return text;
  }
}

export function maskIdCard(idCard: string): string {
  if (!idCard) return idCard;
  // If idCard is encrypted, decrypt it first? No, we assume caller decrypts first.
  
  // Standard Thai ID card length is 13 digits.
  // But we might have other IDs. Let's mask all but last 4.
  if (idCard.length <= 4) return idCard;
  
  const last4 = idCard.slice(-4);
  const maskedLength = idCard.length - 4;
  return '*'.repeat(maskedLength) + last4;
}
