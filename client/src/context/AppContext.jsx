import { createContext, useContext, useState } from 'react';

const AppContext = createContext(null);

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be inside AppProvider');
  return ctx;
}

export function AppProvider({ children }) {
  const [selectedContact, setSelectedContact] = useState(null);
  const [selectedServer, setSelectedServer] = useState(null);
  const [selectedChannel, setSelectedChannel] = useState(null);
  const [contextMenu, setContextMenu] = useState(null);
  // ServerView pushes loaded server + channels here so Layout's sidebar can read them
  const [serverData, setServerData] = useState(null); // { server, channels, categories }

  return (
    <AppContext.Provider value={{
      selectedContact, setSelectedContact,
      selectedServer, setSelectedServer,
      selectedChannel, setSelectedChannel,
      contextMenu, setContextMenu,
      serverData, setServerData,
    }}>
      {children}
    </AppContext.Provider>
  );
}
