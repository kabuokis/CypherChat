<script>
  import { onMount, onDestroy, tick } from 'svelte';
  import { auth } from '$lib/stores/auth.js';
  import { contacts } from '$lib/stores/contacts.js';
  import { messages, conversations } from '$lib/stores/messages.js';
  import { servers } from '$lib/stores/servers.js';
  import { serverMessages } from '$lib/stores/serverMessages.js';
  import { goto } from '$app/navigation';
  import { sha256 } from '@noble/hashes/sha2.js';
  import ServerSidebar from './ServerSidebar.svelte';
  import MemberList from './MemberList.svelte';
  import ChannelCreator from './ChannelCreator.svelte';

  let selectedContact = null;
  let selectedChannel = null;
  let messageText = '';
  let ttl = 'off';
  let searchQuery = '';
  let error = '';
  let sending = false;
  let messagesContainer;
  let showInviteModal = false;
  let inviteCode = '';
  let viewMode = 'dm'; // 'dm' or 'server'

  const TTL_OPTIONS = [
    { value: 'off', label: 'Off' },
    { value: '60000', label: '1 min' },
    { value: '3600000', label: '1 hour' },
    { value: '86400000', label: '1 day' },
    { value: '604800000', label: '1 week' }
  ];

  $: filteredContacts = $contacts.filter(c => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (c.alias || c.username).toLowerCase().includes(q);
  });

  $: currentMessages = selectedContact
    ? ($conversations[selectedContact.usernameHash] || [])
    : [];

  $: unreadCounts = $contacts.reduce((acc, contact) => {
    const msgs = $conversations[contact.usernameHash] || [];
    acc[contact.usernameHash] = msgs.filter(m => !m.read && m.senderUsernameHash === contact.usernameHash).length;
    return acc;
  }, {});

  onMount(() => {
    contacts.init();
    messages.init();
    servers.init();
  });

  $: if ($auth.initialized && !$auth.isAuthenticated) {
    goto('/login');
  }

  $: if ($servers.activeServer) {
    viewMode = 'server';
    serverMessages.stopPolling();
    if (selectedChannel) {
      serverMessages.startPolling($servers.activeServer.id, selectedChannel.id);
    }
  } else {
    viewMode = 'dm';
    serverMessages.stopPolling();
  }

  onDestroy(() => {
    messages.cleanup();
    serverMessages.stopPolling();
  });

  async function selectContact(contact) {
    selectedContact = contact;
    selectedChannel = null;
    viewMode = 'dm';
    serverMessages.stopPolling();
    await tick();
    scrollToBottom();
  }

  async function selectChannel(channel) {
    selectedChannel = channel;
    selectedContact = null;
    viewMode = 'server';
    messages.stopPolling?.();
    serverMessages.startPolling($servers.activeServer.id, channel.id);
    await tick();
    scrollToBottom();
  }

  async function sendMessage() {
    if (!messageText.trim()) return;
    error = '';
    sending = true;

    try {
      if (viewMode === 'dm' && selectedContact) {
        const encoder = new TextEncoder();
        const recipientHash = sha256(encoder.encode(selectedContact.username.normalize('NFKC').toLowerCase()));
        const meta = {};
        if (ttl !== 'off') {
          meta.expiresAt = new Date(Date.now() + parseInt(ttl)).toISOString();
        }
        await messages.sendMessage(recipientHash, selectedContact.publicKey, messageText.trim(), meta);
      } else if (viewMode === 'server' && selectedChannel) {
        await serverMessages.sendMessage($servers.activeServer.id, selectedChannel.id, messageText.trim());
      }
      messageText = '';
      await tick();
      scrollToBottom();
    } catch (err) {
      error = err.message;
    } finally {
      sending = false;
    }
  }

  function scrollToBottom() {
    if (messagesContainer) {
      messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }
  }

  function formatTime(ts) {
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function getTTLRemaining(expiresAt) {
    if (!expiresAt) return null;
    const remaining = expiresAt - Date.now();
    if (remaining <= 0) return 'Expired';
    const seconds = Math.floor(remaining / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h`;
    return `${Math.floor(hours / 24)}d`;
  }

  function groupMessages(msgs) {
    const groups = [];
    let currentGroup = null;
    for (const msg of msgs) {
      const isMine = msg.sent || msg.senderUsername === 'You' || msg.senderName === 'You';
      if (!currentGroup || currentGroup.isMine !== isMine) {
        if (currentGroup) groups.push(currentGroup);
        currentGroup = { isMine, messages: [msg] };
      } else {
        currentGroup.messages.push(msg);
      }
    }
    if (currentGroup) groups.push(currentGroup);
    return groups;
  }

  async function generateInvite() {
    try {
      const code = await servers.generateInvite($servers.activeServer.id);
      inviteCode = code;
      showInviteModal = true;
    } catch (err) {
      error = err.message;
    }
  }

  function copyInvite() {
    navigator.clipboard.writeText(inviteCode);
  }

  $: messageGroups = groupMessages(viewMode === 'dm' ? currentMessages : $serverMessages);
  $: activeServer = $servers.activeServer;
  $: activeChannels = $servers.channels;
  $: activeMembers = $servers.members;
  $: myRole = activeServer?.myRole || 'member';
</script>

<div style="display:flex; height:100vh; overflow:hidden;">
  <!-- Server Sidebar -->
  <ServerSidebar />

  <!-- DM / Channel Sidebar -->
  <div style="width:260px; min-width:260px; background:var(--bg-elevated); border-right:1px solid var(--border); display:flex; flex-direction:column;">
    {#if viewMode === 'server' && activeServer}
      <div style="padding:1rem; border-bottom:1px solid var(--border);">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:0.75rem;">
          <h2 style="font-size:1rem; font-weight:600;">{activeServer.decryptedName || 'Server'}</h2>
          {#if myRole === 'admin' || myRole === 'moderator'}
            <button class="btn-icon" on:click={generateInvite} title="Generate Invite">🔗</button>
          {/if}
        </div>
        <span style="font-size:0.75rem; color:var(--text-muted);">{activeServer.memberCount || 0}/150 members</span>
      </div>

      <div style="padding:0.75rem; border-bottom:1px solid var(--border);">
        <h3 style="font-size:0.75rem; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.05em; margin-bottom:0.5rem;">Channels</h3>
        {#each $activeChannels as channel}
          <button
            on:click={() => selectChannel(channel)}
            class="channel-btn"
            class:active={selectedChannel?.id === channel.id}
          >
            <span>{channel.isPrivate ? '🔒' : '#'}</span>
            <span>{channel.decryptedName || 'channel'}</span>
          </button>
        {/each}
        {#if myRole === 'admin' || myRole === 'moderator'}
          <ChannelCreator serverId={activeServer.id} onCreate={() => servers.loadChannels(activeServer.id)} />
        {/if}
      </div>
    {:else}
      <div style="padding:1rem; border-bottom:1px solid var(--border);">
        <h2 style="font-size:1.1rem; margin-bottom:0.75rem;">Messages</h2>
        <input
          type="text"
          bind:value={searchQuery}
          placeholder="Search contacts..."
          style="font-size:0.875rem; padding:0.5rem 0.75rem;"
        />
      </div>

      <div style="flex:1; overflow-y:auto;">
        {#each filteredContacts as contact}
          <button
            on:click={() => selectContact(contact)}
            class="contact-btn"
            class:active={selectedContact?.usernameHash === contact.usernameHash}
          >
            <div class="avatar">{(contact.alias || contact.username)[0].toUpperCase()}</div>
            <div class="contact-info">
              <div class="contact-name">{contact.alias || contact.username}</div>
              <div class="contact-preview">{$conversations[contact.usernameHash]?.slice(-1)[0]?.content || 'No messages yet'}</div>
            </div>
            {#if unreadCounts[contact.usernameHash]}
              <span class="unread-badge">{unreadCounts[contact.usernameHash]}</span>
            {/if}
          </button>
        {/each}
      </div>
    {/if}

    <div style="padding:1rem; border-top:1px solid var(--border);">
      <a href="/contacts" class="btn btn-secondary" style="width:100%; text-align:center;">+ Add Contact</a>
    </div>
  </div>

  <!-- Main Chat Area -->
  <div style="flex:1; display:flex; flex-direction:column; background:var(--bg);">
    {#if !selectedContact && !selectedChannel}
      <div class="empty-state">
        <div style="text-align:center;">
          <p style="font-size:1.25rem; margin-bottom:0.5rem;">
            {viewMode === 'server' ? 'Select a channel' : 'Select a contact to start chatting'}
          </p>
          <a href="/contacts" class="btn">Add a Contact</a>
        </div>
      </div>
    {:else}
      <!-- Header -->
      <div style="padding:1rem; border-bottom:1px solid var(--border); display:flex; align-items:center; gap:0.75rem;">
        <div class="avatar">
          {#if viewMode === 'dm'}
            {(selectedContact.alias || selectedContact.username)[0].toUpperCase()}
          {:else}
            #
          {/if}
        </div>
        <div>
          <div style="font-weight:600;">
            {viewMode === 'dm' ? (selectedContact.alias || selectedContact.username) : (selectedChannel?.decryptedName || 'Channel')}
          </div>
          <div style="font-size:0.75rem; color:var(--text-muted);">
            {viewMode === 'dm' ? 'Encrypted • E2E' : `${activeServer?.memberCount || 0} members • ${selectedChannel?.isPrivate ? 'Private' : 'Public'}`}
          </div>
        </div>
      </div>

      <!-- Messages -->
      <div bind:this={messagesContainer} class="messages-container">
        {#each messageGroups as group}
          <div class="message-group" style="align-items:{group.isMine ? 'flex-end' : 'flex-start'};">
            {#each group.messages as msg}
              <div class="message-bubble" class:mine={group.isMine}>
                <div class="message-sender">{msg.senderName || msg.senderUsername || 'Unknown'}</div>
                <div>{msg.content}</div>
                <div class="message-meta">
                  <span>{formatTime(msg.timestamp)}</span>
                  {#if msg.expiresAt}
                    <span class="ttl-badge">⏱ {getTTLRemaining(msg.expiresAt)}</span>
                  {/if}
                </div>
              </div>
            {/each}
          </div>
        {/each}
      </div>

      <!-- Input -->
      <div style="padding:1rem; border-top:1px solid var(--border);">
        {#if error}<p class="error" style="margin-bottom:0.5rem;">{error}</p>{/if}
        <div style="display:flex; gap:0.5rem; align-items:flex-end;">
          <textarea
            bind:value={messageText}
            placeholder="Type a message..."
            style="flex:1; resize:none; min-height:44px; max-height:120px;"
            rows="1"
            on:keydown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); } }}
          ></textarea>
          {#if viewMode === 'dm'}
            <select bind:value={ttl} style="width:auto; padding:0.5rem;">
              {#each TTL_OPTIONS as opt}
                <option value={opt.value}>{opt.label}</option>
              {/each}
            </select>
          {/if}
          <button class="btn" on:click={sendMessage} disabled={sending || !messageText.trim()} style="padding:0.625rem 1.25rem;">
            {#if sending}<span class="spinner"></span>{:else}Send{/if}
          </button>
        </div>
      </div>
    {/if}
  </div>

  <!-- Member List (server mode only) -->
  {#if viewMode === 'server' && activeServer}
    <MemberList serverId={activeServer.id} myRole={myRole} />
  {/if}
</div>

<!-- Invite Modal -->
{#if showInviteModal}
  <div class="modal-overlay" on:click={() => showInviteModal = false}>
    <div class="modal" on:click|stopPropagation>
      <h3>Server Invite</h3>
      <p style="color:var(--text-muted); font-size:0.875rem; margin-bottom:1rem;">Share this code with others to join:</p>
      <div class="invite-code">{inviteCode}</div>
      <button class="btn" on:click={copyInvite} style="width:100%; margin-bottom:0.5rem;">Copy to Clipboard</button>
      <button class="btn btn-secondary" on:click={() => showInviteModal = false} style="width:100%;">Close</button>
    </div>
  </div>
{/if}

<style>
  .empty-state {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text-muted);
  }

  .contact-btn, .channel-btn {
    width: 100%;
    text-align: left;
    padding: 0.75rem 1rem;
    background: none;
    border: none;
    border-bottom: 1px solid var(--border);
    color: var(--text);
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 0.75rem;
    transition: background 0.15s;
  }

  .contact-btn:hover, .channel-btn:hover {
    background: var(--bg-surface);
  }

  .contact-btn.active, .channel-btn.active {
    background: var(--bg-surface);
  }

  .channel-btn {
    padding: 0.5rem 0.75rem;
    border: none;
    border-radius: 6px;
    margin-bottom: 2px;
  }

  .avatar {
    width: 36px;
    height: 36px;
    border-radius: 50%;
    background: var(--accent);
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: 600;
    font-size: 0.875rem;
    flex-shrink: 0;
  }

  .contact-info {
    flex: 1;
    min-width: 0;
  }

  .contact-name {
    font-weight: 500;
    font-size: 0.9rem;
  }

  .contact-preview {
    font-size: 0.75rem;
    color: var(--text-muted);
    text-overflow: ellipsis;
    overflow: hidden;
    white-space: nowrap;
  }

  .unread-badge {
    background: var(--accent);
    color: #fff;
    border-radius: 10px;
    padding: 0.125rem 0.5rem;
    font-size: 0.75rem;
    font-weight: 600;
  }

  .messages-container {
    flex: 1;
    overflow-y: auto;
    padding: 1rem;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .message-group {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .message-bubble {
    max-width: 70%;
    padding: 0.625rem 0.875rem;
    border-radius: var(--radius);
    background: var(--bg-surface);
    color: var(--text);
    word-break: break-word;
    position: relative;
  }

  .message-bubble.mine {
    background: var(--accent);
    color: #fff;
  }

  .message-sender {
    font-size: 0.75rem;
    font-weight: 600;
    margin-bottom: 0.25rem;
    opacity: 0.8;
  }

  .message-meta {
    font-size: 0.7rem;
    opacity: 0.7;
    margin-top: 0.25rem;
    display: flex;
    gap: 0.5rem;
    align-items: center;
  }

  .ttl-badge {
    background: rgba(255,255,255,0.2);
    padding: 0.125rem 0.375rem;
    border-radius: 4px;
  }

  .btn-icon {
    background: none;
    border: none;
    color: var(--text-muted);
    cursor: pointer;
    font-size: 1rem;
    padding: 4px;
  }

  .btn-icon:hover {
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

  .invite-code {
    background: var(--bg);
    border: 1px dashed var(--border);
    border-radius: var(--radius);
    padding: 1rem;
    font-family: monospace;
    font-size: 0.875rem;
    word-break: break-all;
    margin-bottom: 1rem;
    text-align: center;
  }
</style>
