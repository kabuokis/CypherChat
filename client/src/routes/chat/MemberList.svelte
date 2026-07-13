<script>
  import { onMount } from 'svelte';
  import { servers } from '$lib/stores/servers.js';
  import { auth } from '$lib/stores/auth.js';

  export let serverId;
  export let myRole = 'member';

  let members = [];
  let loading = true;
  let error = '';
  let showAdminPanel = false;

  const ROLE_COLORS = {
    admin: '#ff5b5b',
    moderator: '#fbbf24',
    member: '#8b929d'
  };

  const ROLE_HIERARCHY = { admin: 3, moderator: 2, member: 1 };

  onMount(async () => {
    await loadMembers();
  });

  async function loadMembers() {
    loading = true;
    error = '';
    try {
      const token = localStorage.getItem('cypherchat_token');
      const res = await fetch(`/api/servers/${serverId}/members`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) throw new Error('Failed to load members');
      const data = await res.json();
      members = data.members || [];
    } catch (err) {
      error = err.message;
    } finally {
      loading = false;
    }
  }

  async function kickMember(userId) {
    if (!confirm('Are you sure you want to kick this member?')) return;
    try {
      await servers.kickMember(serverId, userId);
      members = members.filter(m => m.userId !== userId);
    } catch (err) {
      error = err.message;
    }
  }

  async function changeRole(userId, newRole) {
    try {
      await servers.changeRole(serverId, userId, newRole);
      const m = members.find(m => m.userId === userId);
      if (m) m.role = newRole;
      members = [...members];
    } catch (err) {
      error = err.message;
    }
  }

  function canManage(actorRole, targetRole) {
    return ROLE_HIERARCHY[actorRole] > ROLE_HIERARCHY[targetRole];
  }

  function getFingerprint(pubKeyB64) {
    try {
      const pubKey = Uint8Array.from(atob(pubKeyB64), c => c.charCodeAt(0));
      // Simple fingerprint: first 8 bytes hex
      return Array.from(pubKey.slice(0, 8)).map(b => b.toString(16).padStart(2, '0')).join(':');
    } catch {
      return 'unknown';
    }
  }
</script>

<div class="member-list">
  <div class="member-header">
    <h4>Members — {members.length}/150</h4>
    {#if myRole === 'admin'}
      <button class="admin-toggle" on:click={() => showAdminPanel = !showAdminPanel}>
        {showAdminPanel ? '✕' : '⚙'}
      </button>
    {/if}
  </div>

  {#if loading}
    <p class="loading">Loading members...</p>
  {:else if error}
    <p class="error">{error}</p>
  {:else}
    <div class="member-scroll">
      {#each members as member}
        <div class="member-item">
          <div class="member-avatar" style="border-color: {ROLE_COLORS[member.role]}">
            <span>{(member.decryptedName || '?')[0].toUpperCase()}</span>
          </div>
          <div class="member-info">
            <span class="member-name">{member.decryptedName || 'Unknown'}</span>
            <span class="member-role" style="color: {ROLE_COLORS[member.role]}">{member.role}</span>
            <span class="member-fp">{getFingerprint(member.identityPublicKey)}</span>
          </div>

          {#if showAdminPanel && canManage(myRole, member.role)}
            <div class="member-actions">
              {#if member.role !== 'admin'}
                <button class="action-btn kick" on:click={() => kickMember(member.userId)} title="Kick">
                  🚪
                </button>
              {/if}
              {#if myRole === 'admin'}
                {#if member.role === 'member'}
                  <button class="action-btn promote" on:click={() => changeRole(member.userId, 'moderator')} title="Promote to Moderator">
                    ⬆
                  </button>
                {:else if member.role === 'moderator'}
                  <button class="action-btn demote" on:click={() => changeRole(member.userId, 'member')} title="Demote to Member">
                    ⬇
                  </button>
                {/if}
              {/if}
            </div>
          {/if}
        </div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .member-list {
    width: 240px;
    min-width: 240px;
    background: var(--bg-elevated);
    border-left: 1px solid var(--border);
    display: flex;
    flex-direction: column;
  }

  .member-header {
    padding: 1rem;
    border-bottom: 1px solid var(--border);
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .member-header h4 {
    font-size: 0.875rem;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .admin-toggle {
    background: none;
    border: none;
    color: var(--text-muted);
    cursor: pointer;
    font-size: 1rem;
    padding: 4px;
  }

  .admin-toggle:hover {
    color: var(--accent);
  }

  .member-scroll {
    flex: 1;
    overflow-y: auto;
    padding: 0.5rem;
  }

  .member-item {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.5rem;
    border-radius: 8px;
    transition: background 0.15s;
  }

  .member-item:hover {
    background: var(--bg-surface);
  }

  .member-avatar {
    width: 32px;
    height: 32px;
    border-radius: 50%;
    background: var(--bg-surface);
    border: 2px solid;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.8rem;
    font-weight: 600;
    flex-shrink: 0;
  }

  .member-info {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }

  .member-name {
    font-size: 0.875rem;
    font-weight: 500;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .member-role {
    font-size: 0.7rem;
    text-transform: uppercase;
    font-weight: 600;
  }

  .member-fp {
    font-size: 0.65rem;
    color: var(--text-muted);
    font-family: monospace;
  }

  .member-actions {
    display: flex;
    gap: 4px;
  }

  .action-btn {
    background: none;
    border: none;
    cursor: pointer;
    padding: 4px;
    border-radius: 4px;
    font-size: 0.85rem;
    opacity: 0.6;
    transition: opacity 0.15s, background 0.15s;
  }

  .action-btn:hover {
    opacity: 1;
    background: var(--bg);
  }

  .action-btn.kick:hover { color: var(--danger); }
  .action-btn.promote:hover { color: var(--success); }
  .action-btn.demote:hover { color: var(--warning); }

  .loading, .error {
    padding: 1rem;
    text-align: center;
    font-size: 0.875rem;
  }

  .error {
    color: var(--danger);
  }
</style>
