import { Outlet } from 'react-router-dom';
import { useEffect, useState, useCallback } from 'react';
import { getServers } from '../db/indexeddb';
import ServerSidebar from './ServerSidebar';

export default function Layout() {
  const [servers, setServers] = useState([]);

  const loadServers = useCallback(async () => {
    const s = await getServers();
    setServers(s);
  }, []);

  useEffect(() => {
    loadServers();
  }, [loadServers]);

  return (
    <div className="discord-app">
      {/* Far left: Server list */}
      <ServerSidebar servers={servers} loadServers={loadServers} />

      {/* Main content — ServerView renders its own channel sidebar inside */}
      <main className="main-content" style={{ display: 'flex', flexDirection: 'row' }}>
        <Outlet />
      </main>
    </div>
  );
}