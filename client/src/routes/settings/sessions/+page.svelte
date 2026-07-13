<script>
  import { onMount } from 'svelte';
  import { auth } from '$lib/stores/auth.js';
  import { goto } from '$app/navigation';

  let sessions = [];
  let error = '';
  let loading = true;

  onMount(() => {
    if ($auth.initialized && !$auth.isAuthenticated) {
      goto('/login');
      return;
    }
    loadSessions();
  });

  async function loadSessions() {
    try {
      const res = await fetch('/api/auth/sessions', {
        headers: { 'Authorization': `Bearer ${$auth.token}` }
      });
      if (!res.ok) throw new Error('Failed to load sessions');
      const data = await res.json();
      sessions = data.sessions;
    } catch (err) {
      error = err.message;
    } finally {
      loading = false;
    }
  }

  async function revokeSession(id) {
    try {
      const res = await fetch(`/api/auth/sessions/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${$auth.token}` }
      });
      if (!res.ok) throw new Error('Failed to revoke session');
      sessions = sessions.filter(s => s.id !== id);
    } catch (err) {
      error = err.message;
    }
  }

  function formatDate(d) {
    return new Date(d).toLocaleString();
  }
</script>

<div class="container">
  <h1 class="page-title">Active Sessions</h1>
  <p class="page-subtitle">Manage your signed-in devices</p>

  <div class="card">
    {#if loading}
      <p style="text-align:center; color:var(--text-muted);">Loading sessions...</p>
    {:else if error}
      <p class="error">{error}</p>
    {:else if sessions.length === 0}
      <p style="text-align:center; color:var(--text-muted);">No active sessions</p>
    {:else}
      {#each sessions as session}
        <div class="session-item" class:current={session.current}>
          <div>
            <div style="font-weight:600;">{session.deviceInfo || 'Unknown device'}</div>
            <div style="font-size:0.8rem; color:var(--text-muted);">
              Last seen: {formatDate(session.lastSeen)}
            </div>
            {#if session.current}
              <span style="font-size:0.75rem; color:var(--accent); font-weight:600;">CURRENT</span>
            {/if}
          </div>
          {#if !session.current}
            <button class="btn btn-danger" style="padding:0.4rem 0.8rem; font-size:0.8rem;" on:click={() => revokeSession(session.id)}>
              Revoke
            </button>
          {/if}
        </div>
      {/each}
    {/if}
  </div>

  <div style="text-align:center; margin-top:1rem;">
    <a href="/settings/keys" style="color:var(--text-muted);">← Back to Keys</a>
  </div>
</div>
