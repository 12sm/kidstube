import React, { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';

import ProfileSelect from './pages/ProfileSelect.jsx';
import Home         from './pages/Home.jsx';
import Channels     from './pages/Channels.jsx';
import Channel      from './pages/Channel.jsx';
import Watch        from './pages/Watch.jsx';
import Library      from './pages/Library.jsx';
import History      from './pages/History.jsx';
import Admin        from './pages/Admin.jsx';
import Search       from './pages/Search.jsx';
import MiniPlayer   from './components/MiniPlayer.jsx';
import { PlayerProvider } from './contexts/PlayerContext.jsx';

// Profile context — stores active profile in localStorage
export const ProfileContext = React.createContext(null);

function useProfile() {
  const [profileId,   setProfileId]   = React.useState(() => localStorage.getItem('kidstube_profile_id')   || null);
  const [profileName, setProfileName] = React.useState(() => localStorage.getItem('kidstube_profile_name') || '');

  const selectProfile = (id, name = '') => {
    localStorage.setItem('kidstube_profile_id',   String(id));
    localStorage.setItem('kidstube_profile_name', name);
    setProfileId(String(id));
    setProfileName(name);
  };

  const clearProfile = () => {
    localStorage.removeItem('kidstube_profile_id');
    localStorage.removeItem('kidstube_profile_name');
    setProfileId(null);
    setProfileName('');
  };

  return { profileId, profileName, selectProfile, clearProfile };
}

function OfflineBanner() {
  const [offline, setOffline] = useState(!navigator.onLine);
  useEffect(() => {
    const on  = () => setOffline(false);
    const off = () => setOffline(true);
    window.addEventListener('online',  on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);
  if (!offline) return null;
  return (
    <div className="fixed top-0 left-0 right-0 z-50 bg-yellow-600 text-white text-xs text-center py-2 px-4 font-medium" style={{ paddingTop: 'max(env(safe-area-inset-top), 8px)' }}>
      No internet connection — some features may not work
    </div>
  );
}

export default function App() {
  const profileState = useProfile();

  return (
    <ProfileContext.Provider value={profileState}>
      <PlayerProvider>
        <BrowserRouter>
          <OfflineBanner />
          <Routes>
            <Route path="/"                  element={profileState.profileId ? <Navigate to="/home" replace /> : <ProfileSelect />} />
            <Route path="/home"              element={<Home key="home" />} />
            <Route path="/shorts"            element={<Home key="shorts" />} />
            <Route path="/channels"           element={<Channels />} />
            <Route path="/channel/:channelId" element={<Channel />} />
            <Route path="/watch/:videoId"     element={<Watch />} />
            <Route path="/library"            element={<Library />} />
            <Route path="/library/history"   element={<History />} />
            <Route path="/search"            element={<Search />} />
            <Route path="/admin/*"            element={<Admin />} />
            <Route path="*"                  element={<Navigate to="/" replace />} />
          </Routes>

          {/* Persistent mini player — lives outside Routes so it survives navigation */}
          <MiniPlayer />
        </BrowserRouter>
      </PlayerProvider>
    </ProfileContext.Provider>
  );
}
