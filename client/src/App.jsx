import { Routes, Route, Navigate } from 'react-router-dom';
import { AppProvider } from './context/AppContext';
import Layout from './components/Layout';
import Register from './components/Register';
import Login from './components/Login';
import TOTPSetup from './components/TOTPSetup';
import Chat from './components/Chat';
import Contacts from './components/Contacts';
import Server from './components/Server'; // your server component

export default function App() {
  return (
    <AppProvider>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route element={<Layout />}>
          {/* DM routes — show DM sidebar */}
          <Route path="/chat" element={<Chat />} />
          <Route path="/contacts" element={<Contacts />} />
          <Route path="/totp-setup" element={<TOTPSetup />} />

          {/* Server routes — show server channel sidebar instead */}
          <Route path="/server/:serverId" element={<Server />} />
          <Route path="/server/:serverId/channel/:channelId" element={<Server />} />

          <Route path="/" element={<Navigate to="/chat" />} />
        </Route>
      </Routes>
    </AppProvider>
  );
}
