const { google } = require('googleapis');
const crypto = require('crypto');
const db = require('./db');

// AES-256-CBC token encryption
// ENCRYPTION_KEY must be a 64-char hex string (32 bytes)
function getEncryptionKey() {
  const hexKey = process.env.ENCRYPTION_KEY;
  if (!hexKey || hexKey.length !== 64) {
    throw new Error('ENCRYPTION_KEY must be a 64-character hex string (32 bytes)');
  }
  return Buffer.from(hexKey, 'hex');
}

function encryptToken(plaintext) {
  if (!plaintext) return null;
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  // Store as iv:encrypted in hex
  return iv.toString('hex') + ':' + encrypted.toString('hex');
}

function decryptToken(ciphertext) {
  if (!ciphertext) return null;
  const key = getEncryptionKey();
  const [ivHex, encryptedHex] = ciphertext.split(':');
  if (!ivHex || !encryptedHex) return null;
  const iv = Buffer.from(ivHex, 'hex');
  const encrypted = Buffer.from(encryptedHex, 'hex');
  const decipher = crypto.createDecipheriv('aes-256-cbc', key, iv);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString('utf8');
}

function getOAuthClient() {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );
}

function getAuthUrl(profileId) {
  const oauth2Client = getOAuthClient();
  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/youtube.readonly'],
    prompt: 'consent',
    state: String(profileId)
  });
}

async function exchangeCodeForTokens(code, profileId) {
  const oauth2Client = getOAuthClient();
  const { tokens } = await oauth2Client.getToken(code);

  const encryptedAccess = encryptToken(tokens.access_token);
  const encryptedRefresh = encryptToken(tokens.refresh_token);

  db.updateProfileTokens(profileId, encryptedAccess, encryptedRefresh);
  return tokens;
}

async function getAuthenticatedClient(profileId) {
  const profile = db.getProfile(profileId);
  if (!profile || !profile.google_refresh_token) {
    throw new Error(`Profile ${profileId} has no connected Google account`);
  }

  const oauth2Client = getOAuthClient();
  const refreshToken = decryptToken(profile.google_refresh_token);
  const accessToken = profile.google_access_token ? decryptToken(profile.google_access_token) : null;

  oauth2Client.setCredentials({
    refresh_token: refreshToken,
    access_token: accessToken
  });

  // Refresh if access token is missing or expired
  try {
    const tokenInfo = await oauth2Client.getTokenInfo(oauth2Client.credentials.access_token);
    const expiresIn = tokenInfo.expiry_date - Date.now();
    if (expiresIn < 5 * 60 * 1000) {
      // Expires within 5 minutes, refresh now
      const { credentials } = await oauth2Client.refreshAccessToken();
      db.updateProfileTokens(
        profileId,
        encryptToken(credentials.access_token),
        profile.google_refresh_token // keep existing encrypted refresh token
      );
      oauth2Client.setCredentials(credentials);
    }
  } catch {
    // Token may be expired — force refresh
    const { credentials } = await oauth2Client.refreshAccessToken();
    db.updateProfileTokens(
      profileId,
      encryptToken(credentials.access_token),
      profile.google_refresh_token
    );
    oauth2Client.setCredentials(credentials);
  }

  return oauth2Client;
}

module.exports = {
  getAuthUrl,
  exchangeCodeForTokens,
  getAuthenticatedClient,
  encryptToken,
  decryptToken
};
