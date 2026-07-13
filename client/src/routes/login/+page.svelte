<script>
  import { goto } from '$app/navigation';
  import { deriveKey, storeKeys } from '$lib/crypto/index.js';
  import { sha256 } from '@noble/hashes/sha2.js';
  import { auth } from '$lib/stores/auth.js';
  import { onMount } from 'svelte';

  let username = '';
  let password = '';
  let totpCode = '';
  let recoveryCode = '';
  let error = '';
  let loading = false;
  let step = 'credentials';
  let challengeData = null;
  let usernameHash = null;

  onMount(() => {
    if ($auth.isAuthenticated) goto('/settings/keys');
  });

  async function handleChallenge() {
    error = '';
    if (!username || !password) {
      error = 'Username and password are required';
      return;
    }

    loading = true;
    try {
      const encoder = new TextEncoder();
      usernameHash = sha256(encoder.encode(username.normalize('NFKC').toLowerCase()));
      const usernameHashB64 = btoa(String.fromCharCode(...usernameHash));

      const res = await fetch('/api/auth/login/challenge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ usernameHash: usernameHashB64 })
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Invalid credentials');
      }

      challengeData = await res.json();
      const salt = Uint8Array.from(atob(challengeData.salt), c => c.charCodeAt(0));
      const masterKey = await deriveKey(password, salt);
      const passwordVerifier = sha256(masterKey);

      const challengeBytes = Uint8Array.from(atob(challengeData.challenge), c => c.charCodeAt(0));
      const hmacKey = await crypto.subtle.importKey('raw', passwordVerifier, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
      const hmacResponse = new Uint8Array(await crypto.subtle.sign('HMAC', hmacKey, challengeBytes));

      if (challengeData.requiresTOTP) {
        step = 'totp';
        loading = false;
        return;
      }

      await verifyLogin(hmacResponse);
    } catch (err) {
      error = err.message;
      loading = false;
    }
  }

  async function verifyLogin(hmacResponse, totp = null, recovery = null) {
    try {
      const usernameHashB64 = btoa(String.fromCharCode(...usernameHash));
      const body = {
        usernameHash: usernameHashB64,
        hmacResponse: btoa(String.fromCharCode(...hmacResponse))
      };
      if (totp) body.totpCode = totp;
      if (recovery) body.recoveryCode = recovery;

      const res = await fetch('/api/auth/login/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Login failed');
      }

      const data = await res.json();
      const encryptedKeyBackup = Uint8Array.from(atob(data.encryptedKeyBackup), c => c.charCodeAt(0));
      const salt = Uint8Array.from(atob(challengeData.salt), c => c.charCodeAt(0));
      const masterKey = await deriveKey(password, salt);

      const iv = encryptedKeyBackup.slice(0, 12);
      const ciphertext = encryptedKeyBackup.slice(12);
      const keyMaterial = await crypto.subtle.importKey('raw', masterKey, 'AES-GCM', false, ['decrypt']);
      const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, keyMaterial, ciphertext);

      const combined = new Uint8Array(decrypted);
      const identityPrivateKey = combined.slice(0, 32);
      const signingPrivateKey = combined.slice(32, 64);

      await storeKeys(identityPrivateKey, signingPrivateKey, usernameHash);
      auth.login(data.token, null, usernameHash);
      goto('/settings/keys');
    } catch (err) {
      error = err.message;
      loading = false;
    }
  }

  async function handleTOTP() {
    error = '';
    loading = true;
    const salt = Uint8Array.from(atob(challengeData.salt), c => c.charCodeAt(0));
    const masterKey = await deriveKey(password, salt);
    const passwordVerifier = sha256(masterKey);
    const challengeBytes = Uint8Array.from(atob(challengeData.challenge), c => c.charCodeAt(0));
    const hmacKey = await crypto.subtle.importKey('raw', passwordVerifier, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const hmacResponse = new Uint8Array(await crypto.subtle.sign('HMAC', hmacKey, challengeBytes));

    if (totpCode) {
      await verifyLogin(hmacResponse, totpCode, null);
    } else if (recoveryCode) {
      await verifyLogin(hmacResponse, null, recoveryCode);
    } else {
      error = 'Enter TOTP code or recovery code';
      loading = false;
    }
  }
</script>

<div class="container">
  <h1 class="page-title">Sign In</h1>
  <p class="page-subtitle">Welcome back to CypherChat</p>

  <div class="card">
    {#if step === 'credentials'}
      <div class="form-group">
        <label for="username">Username</label>
        <input id="username" type="text" bind:value={username} placeholder="Your username" />
      </div>

      <div class="form-group">
        <label for="password">Password</label>
        <input id="password" type="password" bind:value={password} placeholder="Your password" />
      </div>

      {#if error}<p class="error">{error}</p>{/if}

      <button class="btn" on:click={handleChallenge} disabled={loading} style="width:100%;">
        {#if loading}<span class="spinner"></span>{/if}
        Sign In
      </button>

    {:else if step === 'totp'}
      <p style="text-align:center; margin-bottom:1rem;">Two-factor authentication required</p>

      <div class="form-group">
        <label for="totp">6-digit TOTP Code</label>
        <input id="totp" type="text" bind:value={totpCode} placeholder="000000" maxlength="6" inputmode="numeric" />
      </div>

      <div class="form-group">
        <label for="recovery">Or Recovery Code</label>
        <input id="recovery" type="text" bind:value={recoveryCode} placeholder="xxxx-xxxx-xxxx" />
      </div>

      {#if error}<p class="error">{error}</p>{/if}

      <button class="btn" on:click={handleTOTP} disabled={loading} style="width:100%;">
        {#if loading}<span class="spinner"></span>{/if}
        Verify
      </button>

      <button class="btn btn-secondary" on:click={() => { step = 'credentials'; totpCode = ''; recoveryCode = ''; error = ''; }} style="width:100%; margin-top:0.5rem;">
        Back
      </button>
    {/if}

    <p style="text-align:center; margin-top:1rem; color:var(--text-muted); font-size:0.875rem;">
      Don't have an account? <a href="/register">Create one</a>
    </p>
  </div>
</div>
