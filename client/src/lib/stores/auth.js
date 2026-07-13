import { writable } from 'svelte/store';

function createAuthStore() {
  const { subscribe, set, update } = writable({
    isAuthenticated: false,
    userId: null,
    usernameHash: null,
    token: null,
    initialized: false
  });

  return {
    subscribe,
    login: (token, userId, usernameHash) => {
      localStorage.setItem('cypherchat_token', token);
      set({ isAuthenticated: true, userId, usernameHash, token, initialized: true });
    },
    logout: () => {
      localStorage.removeItem('cypherchat_token');
      set({ isAuthenticated: false, userId: null, usernameHash: null, token: null, initialized: true });
    },
    init: () => {
      const token = localStorage.getItem('cypherchat_token');
      if (token) {
        try {
          const payload = JSON.parse(atob(token.split('.')[1]));
          set({
            isAuthenticated: true,
            userId: payload.userId,
            usernameHash: payload.usernameHash,
            token,
            initialized: true
          });
        } catch {
          localStorage.removeItem('cypherchat_token');
          set({ isAuthenticated: false, userId: null, usernameHash: null, token: null, initialized: true });
        }
      } else {
        set({ isAuthenticated: false, userId: null, usernameHash: null, token: null, initialized: true });
      }
    }
  };
}

export const auth = createAuthStore();
