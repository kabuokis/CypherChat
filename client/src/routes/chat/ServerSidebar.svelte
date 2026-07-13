<script>
  import { onMount } from 'svelte';
  import { servers } from '$lib/stores/servers.js';
  import { auth } from '$lib/stores/auth.js';
  import { goto } from '$app/navigation';

  let showCreateModal = false;
  let showJoinModal = false;
  let newServerName = '';
  let inviteCode = '';
  let error = '';
  let loading = false;

  onMount(() => {
    if ($auth.isAuthenticated) {
      servers.init();
    }
  });

  async function handleCreate() {
    error = '';
    if (!newServerName.trim()) {
      error = 'Server name is required';
      return;
    }
    loading = true;
    try {
      await servers.createServer(newServerName.trim());
      showCreateModal = false;
      newServerName = '';
    } catch (err) {
      error = err.message;
    } finally {
      loading = false;
    }
  }

  async function handleJoin() {
    error = '';
    if (!inviteCode.trim()) {
      error = 'Invite code is required';
      return;
    }
    loading = true;
    try {
      await servers.joinServer(inviteCode.trim());
      showJoinModal = false;
      inviteCode = '';
    } catch (err) {
      error = err.message;
    } finally {
      loading = false;
    }
  }

  function selectServer(server) {
    servers.selectServer(server);
  }
</script>

<div class="server-sidebar">
  <div class="server-list">
    {#each $servers as server}
      <button
        class="server-icon"
        class:active={$servers.activeServer?.id === server.id}
        on:click={() => selectServer(server)}
        title={server.decryptedName || 'Server'}
      >
        {#if server.iconUrl}
          <img src={server.iconUrl} alt="" />
        {:else}
          <span class="server-initial">{(server.decryptedName || '?')[0].toUpperCase()}</span>
        {/if}
        {#if server.memberCount > 0}
          <span class="member-badge">{server.memberCount}</span>
        {/if}
      </button>
    {/each}

    <div class="server-divider"></div>

    <button class="server-icon add" on:click={() => showCreateModal = true} title="Create Server">
      <span>+</span>
    </button>
    <button class="server-icon join" on:click={() => showJoinModal = true} title="Join Server">
      <span>🔗</span>
    </button>
  </div>

  {#if showCreateModal}
    <div class="modal-overlay" on:click={() => showCreateModal = false}>
      <div class="modal" on:click|stopPropagation>
        <h3>Create a Server</h3>
        <div class="form-group">
          <label>Server Name</label>
          <input type="text" bind:value={newServerName} placeholder="My Awesome Server" />
        </div>
        {#if error}<p class="error">{error}</p>{/if}
        <div class="modal-actions">
          <button class="btn" on:click={handleCreate} disabled={loading}>
            {#if loading}<span class="spinner"></span>{:else}Create{/if}
          </button>
          <button class="btn btn-secondary" on:click={() => showCreateModal = false}>Cancel</button>
        </div>
      </div>
    </div>
  {/if}

  {#if showJoinModal}
    <div class="modal-overlay" on:click={() => showJoinModal = false}>
      <div class="modal" on:click|stopPropagation>
        <h3>Join a Server</h3>
        <div class="form-group">
          <label>Invite Code</label>
          <input type="text" bind:value={inviteCode} placeholder="Paste invite code..." />
        </div>
        {#if error}<p class="error">{error}</p>{/if}
        <div class="modal-actions">
          <button class="btn" on:click={handleJoin} disabled={loading}>
            {#if loading}<span class="spinner"></span>{:else}Join{/if}
          </button>
          <button class="btn btn-secondary" on:click={() => showJoinModal = false}>Cancel</button>
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  .server-sidebar {
    width: 72px;
    min-width: 72px;
    background: var(--bg-elevated);
    border-right: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 12px 0;
    overflow-y: auto;
  }

  .server-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
    align-items: center;
    width: 100%;
  }

  .server-icon {
    width: 48px;
    height: 48px;
    border-radius: 50%;
    background: var(--bg-surface);
    border: none;
    color: var(--text);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: 600;
    font-size: 1.1rem;
    position: relative;
    transition: border-radius 0.2s, background 0.2s;
  }

  .server-icon:hover {
    border-radius: 16px;
    background: var(--accent);
  }

  .server-icon.active {
    border-radius: 16px;
    background: var(--accent);
  }

  .server-icon img {
    width: 100%;
    height: 100%;
    border-radius: inherit;
    object-fit: cover;
  }

  .server-initial {
    font-size: 1.2rem;
    font-weight: 700;
  }

  .member-badge {
    position: absolute;
    bottom: -2px;
    right: -2px;
    background: var(--bg);
    color: var(--text-muted);
    font-size: 0.6rem;
    padding: 2px 5px;
    border-radius: 8px;
    border: 1px solid var(--border);
  }

  .server-divider {
    width: 32px;
    height: 2px;
    background: var(--border);
    border-radius: 1px;
    margin: 4px 0;
  }

  .server-icon.add, .server-icon.join {
    background: var(--bg-surface);
    color: var(--accent);
    font-size: 1.3rem;
  }

  .server-icon.add:hover, .server-icon.join:hover {
    background: var(--accent);
    color: #fff;
  }

  .modal-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.6);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 100;
  }

  .modal {
    background: var(--bg-elevated);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    padding: 1.5rem;
    width: 360px;
    max-width: 90vw;
  }

  .modal h3 {
    margin-bottom: 1rem;
    font-size: 1.25rem;
  }

  .modal-actions {
    display: flex;
    gap: 0.5rem;
    margin-top: 1rem;
  }

  .modal-actions .btn {
    flex: 1;
  }
</style>
