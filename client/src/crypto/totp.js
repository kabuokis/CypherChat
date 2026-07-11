import * as OTPAuth from 'otpauth';

export function generateTOTPSecret() {
  return new OTPAuth.Secret({ size: 20 });
}

export function createTOTP(secret, label) {
  return new OTPAuth.TOTP({
    issuer: 'CypherChat', label,
    algorithm: 'SHA1', digits: 6, period: 30, secret
  });
}

export function generateQRCodeUri(totp) {
  return totp.toString();
}

export function verifyTOTP(totp, code) {
  return totp.validate({ token: code, window: 1 }) !== null;
}

export function generateRecoveryCodes(count = 10) {
  return Array.from({ length: count }, () => {
    const n = crypto.getRandomValues(new Uint32Array(1))[0];
    return n.toString(36).toUpperCase().slice(0, 8).padStart(8, '0');
  });
}