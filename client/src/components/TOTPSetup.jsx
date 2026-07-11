import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { generateTOTPSecret, createTOTP, generateQRCodeUri, verifyTOTP, generateRecoveryCodes } from '../crypto/totp';
import QRCode from 'qrcode';

const API = '/api';

export default function TOTPSetup() {
  const [secret, setSecret] = useState(null);
  const [qr, setQr] = useState('');
  const [code, setCode] = useState('');
  const [codes, setCodes] = useState([]);
  const [step, setStep] = useState('setup');
  const [error, setError] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    if (step !== 'setup') return;
    const sec = generateTOTPSecret();
    const totp = createTOTP(sec, 'user');
    QRCode.toDataURL(generateQRCodeUri(totp)).then(setQr);
    setSecret(sec);
  }, [step]);

  async function handleVerify() {
    const totp = createTOTP(secret, 'user');
    if (!verifyTOTP(totp, code)) {
      setError('Invalid code');
      return;
    }

    const recovery = generateRecoveryCodes();
    const hashes = await Promise.all(recovery.map(async c => {
      const buf = new TextEncoder().encode(c);
      const hash = await crypto.subtle.digest('SHA-256', buf);
      return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
    }));

    const secHash = await crypto.subtle.digest('SHA-256', secret.buffer);

    const res = await fetch(`${API}/auth/totp/setup`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${localStorage.getItem('token')}`
      },
      body: JSON.stringify({
        totpSecret: secret.base32,
        totpSecretHash: b64(new Uint8Array(secHash)),
        recoveryCodesHash: hashes
      })
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      setError(err.error || 'Setup failed');
      return;
    }

    setCodes(recovery);
    setStep('done');
  }

  if (step === 'done') return (
    <div className="page-container">
      <a className="back-link" onClick={() => navigate('/chat')} style={{ cursor: 'pointer' }}>← Back to Chat</a>
      <div className="page-card">
        <h2>2FA Enabled</h2>
        <p className="success">Two-factor authentication is now active on your account.</p>
        <p style={{ marginTop: 12, color: 'var(--text-secondary)' }}>Save these recovery codes somewhere safe. They are shown only once.</p>
        <div className="recovery-codes">
          {codes.map((c, i) => <div key={i}>{c}</div>)}
        </div>
      </div>
    </div>
  );

  return (
    <div className="page-container">
      <a className="back-link" onClick={() => navigate('/chat')} style={{ cursor: 'pointer' }}>← Back to Chat</a>
      <div className="page-card">
        <h2>Setup Two-Factor Auth</h2>
        <p>Scan the QR code with your authenticator app (Google Authenticator, Authy, etc.)</p>
        {step === 'setup' ? (
          <>
            {qr && <img src={qr} alt="QR Code" className="qr-img" />}
            <code className="totp-secret">{secret?.base32}</code>
            <button onClick={() => setStep('verify')}>I have scanned it</button>
          </>
        ) : (
          <>
            <p style={{ color: 'var(--text-secondary)' }}>Enter the 6-digit code to confirm</p>
            <input value={code} onChange={e => setCode(e.target.value)} maxLength={6} placeholder="000000" />
            {error && <div className="error">{error}</div>}
            <button onClick={handleVerify} style={{ marginTop: 12 }}>Enable 2FA</button>
          </>
        )}
      </div>
    </div>
  );
}

function b64(bytes) {
  return btoa(String.fromCharCode(...bytes));
}