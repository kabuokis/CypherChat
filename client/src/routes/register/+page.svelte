<script>
  import { goto } from '$app/navigation';
  import { generateIdentityKeyPair, generateSigningKeyPair, deriveKey, storeKeys } from '$lib/crypto/index.js';
  import { sha256 } from '@noble/hashes/sha2.js';
  import { auth } from '$lib/stores/auth.js';

  let username = '';
  let password = '';
  let email = '';
  let confirmPassword = '';
  let error = '';
  let loading = false;

  async function handleRegister() {
    error = '';
    if (!username || !password) {
      error = 'Username and password are required';
      return;
    }
    if (password !== confirmPassword) {
      error = 'Passwords do not match';
      return;
    }
    if (password.length < 12) {
      error = 'Password must be at least 12 characters';
      return;
    }

    loading = true;
    try {
      const encoder = new TextEncoder();
      const usernameBytes = encoder.encode(username.normalize('NFKC').toLowerCase());
      const usernameHash = sha256(usernameBytes);
      const emailHash = email ? sha256(encoder.encode(email.normalize('NFKC').toLowerCase())) : null;

      const salt = crypto.getRandomValues(new Uint8Array(16));
      const masterKey = await deriveKey(password, salt);
      const passwordVerifier = sha256(masterKey);

      const identityKP = generateIdentityKeyPair();
      const signingKP = generateSigningKeyPair();

      const iv = crypto.getRandomValues(new Uint8Array(12));
      const keyMaterial = await crypto.subtle.importKey('raw', masterKey, 'AES-GCM', false, ['encrypt']);
      const combinedPriv = new Uint8Array(64);
      combinedPriv.set(identityKP.privateKey, 0);
      combinedPriv.set(signingKP.privateKey, 32);
      const encryptedBackup = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, keyMaterial, combinedPriv);
      const encryptedKeyBackup = new Uint8Array(iv.length + encryptedBackup.byteLength);
      encryptedKeyBackup.set(iv, 0);
      encryptedKeyBackup.set(new Uint8Array(encryptedBackup), iv.length);

      const body = {
        usernameHash: btoa(String.fromCharCode(...usernameHash)),
        argon2Salt: btoa(String.fromCharCode(...salt)),
        passwordVerifier: btoa(String.fromCharCode(...passwordVerifier)),
        identityPublicKey: btoa(String.fromCharCode(...identityKP.publicKey)),
        signingPublicKey: btoa(String.fromCharCode(...signingKP.publicKey)),
        encryptedKeyBackup: btoa(String.fromCharCode(...encryptedKeyBackup))
      };
      if (emailHash) body.emailHash = btoa(String.fromCharCode(...emailHash));

      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Registration failed');
      }

      const { token } = await res.json();
      await storeKeys(identityKP.privateKey, signingKP.privateKey, usernameHash);
      auth.login(token, null, usernameHash);
      goto('/settings/keys');
    } catch (err) {
      error = err.message;
    } finally {
      loading = false;
    }
  }
</script>

<div class="container">
  <h1 class="page-title">Create Account</h1>
  <p class="page-subtitle">Your keys stay on your device</p>

  <div class="card">
    <div class="form-group">
      <label for="username">Username</label>
      <input id="username" type="text" bind:value={username} placeholder="Choose a username" />
    </div>

    <div class="form-group">
      <label for="email">Email (optional)</label>
      <input id="email" type="email" bind:value={email} placeholder="you@example.com" />
    </div>

    <div class="form-group">
      <label for="password">Password</label>
      <input id="password" type="password" bind:value={password} placeholder="At least 12 characters" />
    </div>

    <div class="form-group">
      <label for="confirm">Confirm Password</label>
      <input id="confirm" type="password" bind:value={confirmPassword} placeholder="Repeat password" />
    </div>

    {#if error}<p class="error">{error}</p>{/if}

    <button class="btn" on:click={handleRegister} disabled={loading} style="width:100%;">
      {#if loading}<span class="spinner"></span>{/if}
      Create Account
    </button>

    <p style="text-align:center; margin-top:1rem; color:var(--text-muted); font-size:0.875rem;">
      Already have an account? <a href="/login">Sign in</a>
    </p>
  </div>
</div>
