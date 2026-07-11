import { Routes, Route, Navigate } from 'react-router-dom';
import { AppProvider } from './context/AppContext';
import Layout from './components/Layout';
import Register from './components/Register';
import Login from './components/Login';
import TOTPSetup from './components/TOTPSetup';
import Chat from './components/Chat';
import Contacts from './components/Contacts';
import ServerView from './components/ServerView';

export default function App() {
  return (
    <AppProvider>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route element={<Layout />}>
          <Route path="/chat" element={<Chat />} />
          <Route path="/contacts" element={<Contacts />} />
          <Route path="/totp-setup" element={<TOTPSetup />} />
          <Route path="/server/:serverId" element={<ServerView />} />
          <Route path="/" element={<Navigate to="/chat" />} />
        </Route>
      </Routes>
    </AppProvider>
  );
}