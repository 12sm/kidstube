import React from 'react';

// Direct embed iframe — autoplay=1 in the URL is handled by YouTube's own
// player on load, which iOS treats as in-context (vs. async playVideo() calls
// from the IFrame API which lose the user gesture and get blocked).
export default function Player({ videoId }) {
  if (!videoId) return null;

  const src =
    `https://www.youtube.com/embed/${videoId}` +
    `?autoplay=1` +
    `&playsinline=1` +
    `&rel=0` +
    `&modestbranding=1` +
    `&fs=1` +
    `&cc_load_policy=0` +
    `&iv_load_policy=3` +
    `&controls=1`;

  return (
    <div className="w-full aspect-video bg-black">
      <iframe
        key={videoId}
        src={src}
        className="w-full h-full border-0"
        allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
        allowFullScreen
        title="Video player"
      />
    </div>
  );
}
