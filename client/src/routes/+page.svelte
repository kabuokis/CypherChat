<script>
  import { auth } from '$lib/stores/auth.js';
  import { goto } from '$app/navigation';
  import { onMount } from 'svelte';

  onMount(() => {
    if ($auth.isAuthenticated) {
      goto('/chat');
    }
  });
</script>

<div class="container" style="text-align:center; padding-top:4rem;">
  <h1 class="page-title" style="font-size:2.5rem; margin-bottom:0.5rem;">🔐 CypherChat</h1>
  <p class="page-subtitle">Privacy-first, end-to-end encrypted messenger</p>

  <div style="display:flex; flex-direction:column; gap:1rem; max-width:300px; margin:2rem auto;">
    <a href="/register" class="btn">Create Account</a>
    <a href="/login" class="btn btn-secondary">Sign In</a>
  </div>
</div>
