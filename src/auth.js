const crypto = require('crypto');

const timingSafeEqualStrings = (left, right) => {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
};

const extractBearerToken = (authorizationHeader) => {
  const value = String(authorizationHeader ?? '').trim();

  if (!value.toLowerCase().startsWith('bearer ')) {
    return '';
  }

  return value.slice(7).trim();
};

const extractApiKeyFromRequest = (req) => {
  const bearerToken = extractBearerToken(req.headers?.authorization);

  if (bearerToken) {
    return bearerToken;
  }

  return String(req.headers?.['x-api-key'] ?? '').trim();
};

const createAuthGuard = (apiKey) => (req) => {
  const token = extractApiKeyFromRequest(req);

  if (!token || !apiKey) {
    return false;
  }

  return timingSafeEqualStrings(token, apiKey);
};

module.exports = {
  createAuthGuard,
  extractApiKeyFromRequest,
  extractBearerToken,
  timingSafeEqualStrings
};
