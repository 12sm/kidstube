import React, { useContext, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ProfileContext } from '../App.jsx';

const AVATAR_COLORS = ['#e05252', '#4e9de0', '#50c878', '#e0a035', '#9b59b6', '#e07c4e'];

export default function ProfileSelect() {
  const { selectProfile } = useContext(ProfileContext);
  const navigate = useNavigate();
  const [profiles, setProfiles] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/profiles')
      .then(r => r.json())
      .then(data => { setProfiles(data.profiles || []); setLoading(false); })
      .catch(() => { setProfiles([]); setLoading(false); });
  }, []);

  const handleSelect = (profile) => {
    selectProfile(profile.id, profile.name);
    navigate('/home');
  };

  return (
    <div className="min-h-screen bg-yt-bg flex flex-col items-center justify-center p-6">
      {/* Logo */}
      <div className="mb-10 text-center">
        <div className="flex items-center justify-center gap-2 mb-2">
          <div className="w-8 h-8 rounded-lg bg-yt-red flex items-center justify-center">
            <svg viewBox="0 0 24 24" className="w-5 h-5 fill-white">
              <path d="M8 5v14l11-7z" />
            </svg>
          </div>
          <span className="text-2xl font-bold text-yt-text tracking-tight">YouTube</span>
        </div>
        <p className="text-yt-muted text-sm">Who's watching?</p>
      </div>

      {loading ? (
        <div className="text-yt-muted text-sm">Loading...</div>
      ) : profiles.length === 0 ? (
        <div className="text-center text-yt-muted space-y-3">
          <p>No profiles set up yet.</p>
          <a href="/admin" className="text-blue-400 underline text-sm">Set up profiles in Admin</a>
        </div>
      ) : (
        <div className="flex flex-wrap gap-6 justify-center max-w-lg">
          {profiles.map((profile, i) => (
            <button
              key={profile.id}
              onClick={() => handleSelect(profile)}
              className="flex flex-col items-center gap-3 group"
            >
              <div
                className="w-32 h-32 rounded-2xl flex items-center justify-center text-5xl font-bold text-white shadow-lg group-hover:scale-105 group-hover:shadow-2xl transition-all duration-200"
                style={{ backgroundColor: AVATAR_COLORS[i % AVATAR_COLORS.length] }}
              >
                {profile.name.charAt(0).toUpperCase()}
              </div>
              <span className="text-yt-text text-base font-medium group-hover:text-white transition-colors">
                {profile.name}
              </span>
            </button>
          ))}
        </div>
      )}

      <a href="/admin" className="mt-16 text-yt-muted hover:text-yt-text text-xs transition-colors">
        Parent controls
      </a>
    </div>
  );
}
