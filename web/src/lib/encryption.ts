import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';

export interface EncryptedPayload {
  encrypted: string;
  iv: string;
  tag: string;
}

function getMasterKey(): Buffer {
  const hex =
    process.env.ENCRYPTION_MASTER_KEY ||
    '7a0e2e8468c1008f22a662bd17dee64128a8ebbf91d5b2ebfe36eff9e4e91bc6';
  if (!hex || hex.length !== 64) {
    throw new Error('ENCRYPTION_MASTER_KEY must be exactly 32 bytes in 64 hex characters');
  }
  return Buffer.from(hex, 'hex');
}

export function encryptString(plainText: string): EncryptedPayload {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, getMasterKey(), iv);

  let encrypted = cipher.update(plainText, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const tag = cipher.getAuthTag().toString('hex');

  return {
    encrypted,
    iv: iv.toString('hex'),
    tag,
  };
}

export function decryptString(encryptedHex: string, ivHex?: string, tagHex?: string): string {
  let actualEncrypted = encryptedHex;
  let actualIv = ivHex || '';
  let actualTag = tagHex || '';

  // Self-contained package format "iv:tag:ciphertext"
  if (encryptedHex && encryptedHex.includes(':')) {
    const parts = encryptedHex.split(':');
    if (parts.length === 3) {
      actualIv = parts[0];
      actualTag = parts[1];
      actualEncrypted = parts[2];
    }
  }

  if (!actualIv || !actualTag) {
    throw new Error('Missing IV or Auth Tag for AES-256-GCM decryption');
  }

  const decipher = crypto.createDecipheriv(
    ALGORITHM,
    getMasterKey(),
    Buffer.from(actualIv, 'hex')
  );
  decipher.setAuthTag(Buffer.from(actualTag, 'hex'));

  let decrypted = decipher.update(actualEncrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

export function encryptPayload(plainText: string): string {
  const payload = encryptString(plainText);
  return `${payload.iv}:${payload.tag}:${payload.encrypted}`;
}
