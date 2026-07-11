import { createContext, useContext, useState } from 'react';

const AppContext = createContext(null);

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be inside AppProvider');
  return ctx;
}

export function AppProvider({ children }) {
  const [selectedContact, setSelectedContact] = useState(null);
  return (
    <AppContext.Provider value={{ selectedContact, setSelectedContact }}>
      {children}
    </AppContext.Provider>
  );
}