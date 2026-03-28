import React, { useContext } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { ProfileContext } from '../App.jsx';

const AVATAR_COLORS = ['#e05252', '#4e9de0', '#50c878', '#e0a035', '#9b59b6', '#e07c4e'];

const HomeIcon = ({ active }) => (
  <svg viewBox="0 0 24 24" className={`w-6 h-6 ${active ? 'fill-white' : 'fill-current text-yt-muted'}`}>
    <path d={active
      ? 'M10 20v-6h4v6h5v-8h3L12 3 2 12h3v8z'
      : 'M12 5.69l5 4.5V18h-2v-6H9v6H7v-7.81l5-4.5M12 3L2 12h3v8h6v-6h2v6h6v-8h3L12 3z'
    } />
  </svg>
);

// YouTube Shorts "S" bolt logo
const ShortsIcon = ({ active }) => (
  <svg viewBox="0 0 24 24" className={`w-6 h-6 ${active ? 'fill-white' : 'fill-current text-yt-muted'}`}>
    <path d="M17.77 10.32l-1.2-.5.43-.5c1.24-1.44 1.12-3.6-.26-4.88-1.38-1.29-3.55-1.24-4.89.12L8 9h3v10.56c0 .26.21.44.45.44.1 0 .2-.03.28-.1L17 15h-3l3.77-4.68z"/>
  </svg>
);

// YouTube Subscriptions icon (film ticket with play)
const SubscriptionsIcon = ({ active }) => (
  <svg viewBox="0 0 24 24" className={`w-6 h-6 ${active ? 'fill-white' : 'fill-current text-yt-muted'}`}>
    {active
      ? <path d="M20 8H4V6h16v2zm-2-6H6v2h12V2zm4 10v8c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2v-8c0-1.1.9-2 2-2h16c1.1 0 2 .9 2 2zm-6 4l-6-3.27v6.53L16 16z"/>
      : <>
          <path d="M20 8H4V6h16v2zm-2-6H6v2h12V2zm4 10v8c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2v-8c0-1.1.9-2 2-2h16c1.1 0 2 .9 2 2zm-2 0H4v8h16v-8zm-6 4l-6-3.27v6.53L14 16z"/>
        </>
    }
  </svg>
);

function YouAvatar({ active, initial, color }) {
  return (
    <div
      className="w-6 h-6 rounded-full flex items-center justify-center text-white text-xs font-bold transition-all"
      style={{
        backgroundColor: color,
        boxShadow: active ? `0 0 0 2px white` : 'none',
        opacity: active ? 1 : 0.6,
      }}
    >
      {initial}
    </div>
  );
}

const tabs = [
  { label: 'Home',          path: '/home',     type: 'home' },
  { label: 'Shorts',        path: '/shorts',   type: 'shorts' },
  { label: 'Subscriptions', path: '/channels', type: 'subscriptions' },
  { label: 'You',           path: '/library',  type: 'you' },
];

export default function BottomNav() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { profileId, profileName } = useContext(ProfileContext);

  const avatarColor   = AVATAR_COLORS[(parseInt(profileId || '1') - 1) % AVATAR_COLORS.length];
  const avatarInitial = profileName?.charAt(0)?.toUpperCase() || '?';

  const haptic = () => {
    if (navigator.vibrate) { navigator.vibrate(10); return; }
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain); gain.connect(ctx.destination);
      gain.gain.setValueAtTime(0.0001, ctx.currentTime);
      osc.start(ctx.currentTime); osc.stop(ctx.currentTime + 0.01);
      setTimeout(() => ctx.close(), 100);
    } catch { /* ignore */ }
  };

  const handleTab = (path) => {
    haptic();
    navigate(path);
  };

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-20 bg-yt-surface/95 backdrop-blur-sm border-t border-yt-border flex xl:hidden"
      style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
    >
      {tabs.map(({ label, path, type }) => {
        const active = pathname === path;
        return (
          <button
            key={path}
            onClick={() => handleTab(path)}
            className={`flex-1 flex flex-col items-center gap-1 py-3 transition-colors ${active ? 'text-white' : 'text-yt-muted'}`}
          >
            {type === 'home'          && <HomeIcon active={active} />}
            {type === 'shorts'        && <ShortsIcon active={active} />}
            {type === 'subscriptions' && <SubscriptionsIcon active={active} />}
            {type === 'you'           && <YouAvatar active={active} initial={avatarInitial} color={avatarColor} />}
            <span className={`text-xs ${active ? 'font-medium' : ''}`}>{label}</span>
          </button>
        );
      })}
    </nav>
  );
}
