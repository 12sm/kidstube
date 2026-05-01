import React, { useState, useEffect } from 'react';
import { Routes, Route } from 'react-router-dom';

import AdminNav from './admin/AdminNav';
import HomeTab from './admin/HomeTab';
import KidsTab from './admin/KidsTab';
import ContentTab from './admin/ContentTab';
import SettingsTab from './admin/SettingsTab';

// Simple admin auth — JWT stored in cookie by backend, checked here
function useAdminAuth() {
  const [authed, setAuthed] = useState(false);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    fetch('/api/admin/me', { credentials: 'include' })
      .then(r => {
        setAuthed(r.ok);
        setChecking(false);
      })
      .catch(() => {
        setAuthed(false);
        setChecking(false);
      });
  }, []);

  return { authed, setAuthed, checking };
}

function AdminLogin({ onLogin }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ password })
      });
      if (res.ok) {
        onLogin();
      } else {
        setError('Incorrect password');
      }
    } catch {
      setError('Connection error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-yt-bg flex items-center justify-center p-6">
      <div className="bg-yt-surface rounded-xl p-8 w-full max-w-sm border border-yt-border">
        <h1 className="text-xl font-semibold text-yt-text mb-6">YouTube Admin</h1>
        <form onSubmit={handleSubmit} className="space-y-4">
          <input
            type="password"
            placeholder="Admin password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            className="w-full bg-yt-card border border-yt-border rounded-lg px-4 py-2 text-yt-text focus:outline-none focus:border-blue-500"
          />
          {error && <p className="text-red-400 text-sm">{error}</p>}
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-700 text-white rounded-lg px-4 py-2 font-medium disabled:opacity-50"
          >
            {loading ? 'Logging in...' : 'Log In'}
          </button>
        </form>
      </div>
    </div>
  );
}

export default function Admin() {
  const { authed, setAuthed, checking } = useAdminAuth();

  if (checking) {
    return <div className="min-h-screen bg-yt-bg flex items-center justify-center text-yt-muted">Loading...</div>;
  }

  if (!authed) {
    return <AdminLogin onLogin={() => setAuthed(true)} />;
  }

  return (
    <div className="min-h-screen bg-yt-bg">
      <AdminNav />

      {/* Main content area — offset for sidebar on desktop, bottom nav on mobile */}
      <main
        className="lg:ml-56 px-4 py-4 pb-20 lg:pb-4"
        style={{ paddingTop: 'max(env(safe-area-inset-top), 16px)' }}
      >
        <div className="max-w-4xl mx-auto">
          <Routes>
            <Route index element={<HomeTab />} />
            <Route path="kids" element={<KidsTab />} />
            <Route path="content" element={<ContentTab />} />
            <Route path="settings" element={<SettingsTab />} />
          </Routes>
        </div>
      </main>
    </div>
  );
}
