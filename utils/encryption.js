const crypto = require('crypto');
require('dotenv').config();

// This automatically hashes your .env password into a perfect 32-byte buffer
// It prevents the 'Invalid key length' error no matter what you type in .env
const ENCRYPTION_KEY = crypto
    .createHash('sha256')
    .update(String(process.env.ENCRYPTION_KEY))
    .digest();
const ALGORITHM = 'aes-256-gcm';

// Encrypts the token before saving to the database
function encryptToken(text) {
    const iv = crypto.randomBytes(16); // Initialization vector
    const cipher = crypto.createCipheriv(ALGORITHM, Buffer.from(ENCRYPTION_KEY), iv);
    
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    
    const authTag = cipher.getAuthTag().toString('hex');
    
    // We store the IV, the encrypted text, and the auth tag together
    return `${iv.toString('hex')}:${encrypted}:${authTag}`;
}

// Decrypts the token when the Advisor needs to send an email
function decryptToken(encryptedData) {
    const parts = encryptedData.split(':');
    const iv = Buffer.from(parts[0], 'hex');
    const encryptedText = parts[1];
    const authTag = Buffer.from(parts[2], 'hex');
    
    const decipher = crypto.createDecipheriv(ALGORITHM, Buffer.from(ENCRYPTION_KEY), iv);
    decipher.setAuthTag(authTag);
    
    let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
}

module.exports = { encryptToken, decryptToken };