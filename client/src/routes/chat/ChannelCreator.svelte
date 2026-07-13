<script>
  import { servers } from '$lib/stores/servers.js';

  export let serverId;
  export let onCreate = () => {};

  let showModal = false;
  let channelName = '';
  let isPrivate = false;
  let requiredRole = 'member';
  let error = '';
  let loading = false;

  async function create() {
    error = '';
    if (!channelName.trim()) {
      error = 'Channel name is required';
      return;
    }
    loading = true;
    try {
      await servers.createChannel(serverId, channelName.trim(), isPrivate, requiredRole);
      showModal = false;
      channelName = '';
      isPrivate = false;
      requiredRole = 'member';
      onCreate();
    } catch (err) {
      error = err.message;
    } finally {
      loading = false;
    }
  }
</script>

<button class="new-channel-btn" on:click={() => showModal = true}>
  <span>+</span> New Channel
</button>

{#if showModal}
  <div class="modal-overlay" on:click={() => showModal = false}>
    <div class="modal" on:click|stopPropagation>
      <h3>Create Channel</h3>
      <div class="form-group">
        <label>Channel Name</label>
        <input type="text" bind:value={channelName} placeholder="general, random, etc." />
      </div>

      <div class="form-group">
        <label class="checkbox-label">
          <input type="checkbox" bind:checked={isPrivate} />
          Private Channel
        </label>
      </div>

      {#if isPrivate}
        <div class="form-group">
          <label>Required Role</label>
          <select bind:value={requiredRole}>
            <option value="moderator">Moderator+</option>
            <option value="admin">Admin only</option>
          </select>
        </div>
      {/if}

      {#if error}<p class="error">{error}</p>{/if}

      <div class="modal-actions">
        <button class="btn" on:click={create} disabled={loading}>
          {#if loading}<span class="spinner"></span>{:else}Create{/if}
        </button>
        <button class="btn btn-secondary" on:click={() => showModal = false}>Cancel</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .new-channel-btn {
    width: 100%;
    padding: 0.5rem 0.75rem;
    background: none;
    border: 1px dashed var(--border);
    border-radius: var(--radius);
    color: var(--text-muted);
    cursor: pointer;
    font-size: 0.875rem;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    transition: all 0.2s;
  }

  .new-channel-btn:hover {
    border-color: var(--accent);
    color: var(--accent);
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
    width: 400px;
    max-width: 90vw;
  }

  .modal h3 {
    margin-bottom: 1rem;
  }

  .checkbox-label {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    cursor: pointer;
  }

  .checkbox-label input {
    width: auto;
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
