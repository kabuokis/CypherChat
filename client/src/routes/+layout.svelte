<script>
  import '../app.css';
  import { auth } from '$lib/stores/auth.js';
  import { browser } from '$app/environment';

  if (browser) {
    auth.init();
  }
</script>

<slot />
