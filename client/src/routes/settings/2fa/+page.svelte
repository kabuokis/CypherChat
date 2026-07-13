<script>
  import { onMount } from 'svelte';
  import { auth } from '$lib/stores/auth.js';
  import { goto } from '$app/navigation';
  import { TOTP } from 'otpauth';
  import QRCode from 'qrcode';
  import { sha256 } from '@noble/hashes/sha2.js';

  let secret = '';
  let qrDataUrl = '';
  let totpCode = '';
  let recoveryCodes = [];
  let error = '';
  let success = '';
  let loading = false;
  let setupComplete = false;

  onMount(() => {
    if (!$auth.isAuthenticated) goto('/login');
    generateTOTP();
  });

  function generateTOTP() {
    const totp = new TOTP({
      issuer: 'CypherChat',
      label: 'CypherChat',
      algorithm: 'SHA1',
      digits: 6,
      period: 30
    });
    secret = totp.secret.base32;
    const uri = totp.toString();
    QRCode.toDataURL(uri, { width: 200, margin: 2 }).then(url => {
      qrDataUrl = url;
    });

    recoveryCodes = Array.from({ length: 8 }, () => {
      const bytes = crypto.getRandomValues(new Uint8Array(4));
      const hex = Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
      return `${hex.slice(0,4)}-${hex.slice(4,8)}-${hex.slice(8,12)}`;
    });
  }

  async function verifyAndSave() {
    error = '';
    success = '';
    if (!totpCode || totpCode.length !== 6) {
      error = 'Enter the 6-digit code from your authenticator app';
      return;
    }

    const totp = new TOTP({
      secret,
      algorithm: 'SHA1',
      digits: 6,
      period: 30
    });

    const isValid = totp.validate({ token: totpCode, window: 1 }) !== null;
    if (!isValid) {
      error = 'Invalid code. Please try again.';
      return;
    }

    loading = true;
    try {
      const totpSecretHash = sha256(new TextEncoder().encode(secret));
      const recoveryCodesHash = recoveryCodes.map(code => btoa(String.fromCharCode(...sha256(new TextEncoder().encode(code)))));

      const res = await fetch('/api/auth/totp/setup', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${$auth.token}`
        },
        body: JSON.stringify({
          totpSecret: secret,
          totpSecretHash: btoa(String.fromCharCode(...totpSecretHash)),
          recoveryCodesHash
        })
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Setup failed');
      }

      setupComplete = true;
      success = 'Two-factor authentication enabled successfully!';
    } catch (err) {
      error = err.message;
    } finally {
      loading = false;
    }
  }
</script>

<div class="container">
  <h1 class="page-title">Two-Factor Authentication</h1>
  <p class="page-subtitle">Secure your account with TOTP</p>

  <div class="card">
    {#if !setupComplete}
      <p style="margin-bottom:1rem;">Scan this QR code with your authenticator app:</p>

      {#if qrDataUrl}
        <div class="qr-wrap" style="text-align:center;">
          <img src={qrDataUrl} alt="TOTP QR Code" style="display:block;" />
        </div>
      {/if}

      <p style="font-family:monospace; text-align:center; background:var(--bg); padding:0.75rem; border-radius:var(--radius); margin:1rem 0; word-break:break-all;">
        {secret}
      </p>

      <div class="form-group">
        <label for="verify">Verification Code</label>
        <input id="verify" type="text" bind:value={totpCode} placeholder="000000" maxlength="6" inputmode="numeric" />
      </div>

      {#if error}<p class="error">{error}</p>{/if}

      <button class="btn" on:click={verifyAndSave} disabled={loading} style="width:100%;">
        {#if loading}<span class="spinner"></span>{/if}
        Verify & Enable 2FA
      </button>

      <div style="margin-top:2rem;">
        <p style="color:var(--text-muted); margin-bottom:0.5rem;">Save these recovery codes securely:</p>
        <div class="recovery-codes">
          {#each recoveryCodes as code}
            <div>{code}</div>
          {/each}
        </div>
      </div>
    {:else}
      <p class="success" style="text-align:center; font-size:1.1rem;">{success}</p>
      <div style="margin-top:1.5rem; text-align:center;">
        <a href="/settings/sessions" class="btn btn-secondary">Manage Sessions</a>
      </div>
    {/if}
  </div>

  <div style="text-align:center; margin-top:1rem;">
    <a href="/settings/keys" style="color:var(--text-muted);">← Back to Keys</a>
  </div>
</div>
