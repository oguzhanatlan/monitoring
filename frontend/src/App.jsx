import { useEffect, useState } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import axios from 'axios';
import { AuthProvider, useAuth } from './AuthContext.jsx';
import Layout from './components/Layout.jsx';
import Login from './pages/Login.jsx';
import Setup from './pages/Setup.jsx';
import Users from './pages/Users.jsx';
import Dashboard from './pages/Dashboard.jsx';
import FileManager from './pages/FileManager.jsx';
import Terminal from './pages/Terminal.jsx';

function Gate() {
  const { user, loading } = useAuth();
  const [needsSetup, setNeedsSetup] = useState(null);

  useEffect(() => {
    axios
      .get('/api/auth/setup-status')
      .then((res) => setNeedsSetup(res.data.needsSetup))
      .catch(() => setNeedsSetup(false));
  }, [user]);

  if (loading || needsSetup === null) {
    return <div className="app-loading">Yükleniyor…</div>;
  }
  if (!user) {
    return needsSetup ? <Setup onDone={() => setNeedsSetup(false)} /> : <Login />;
  }

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/files" element={<FileManager />} />
        <Route path="/terminal" element={<Terminal />} />
        <Route path="/users" element={<Users />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <Gate />
    </AuthProvider>
  );
}
