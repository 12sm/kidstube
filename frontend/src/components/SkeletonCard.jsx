import React from 'react';

export function SkeletonCard({ compact = false }) {
  if (compact) {
    return (
      <div className="flex gap-3 w-full p-2">
        <div className="skeleton flex-shrink-0 w-36 rounded-lg" style={{ aspectRatio: '16/9' }} />
        <div className="flex-1 min-w-0 pt-0.5 space-y-2">
          <div className="skeleton h-3.5 w-full rounded" />
          <div className="skeleton h-3.5 w-4/5 rounded" />
          <div className="skeleton h-3 w-1/2 rounded mt-3" />
          <div className="skeleton h-3 w-2/5 rounded" />
        </div>
      </div>
    );
  }

  return (
    <div className="block w-full">
      <div className="skeleton w-full rounded-xl" style={{ aspectRatio: '16/9' }} />
      <div className="mt-2 flex gap-2">
        <div className="skeleton w-9 h-9 rounded-full flex-shrink-0 mt-0.5" style={{ borderRadius: '50%' }} />
        <div className="flex-1 min-w-0 space-y-2 pt-0.5">
          <div className="skeleton h-3.5 w-full rounded" />
          <div className="skeleton h-3.5 w-4/5 rounded" />
          <div className="skeleton h-3 w-2/5 rounded mt-1" />
        </div>
      </div>
    </div>
  );
}

export function SkeletonChannelCircle() {
  return (
    <div className="flex flex-col items-center gap-2">
      <div className="skeleton w-16 h-16" style={{ borderRadius: '50%' }} />
      <div className="skeleton h-3 w-14 rounded" />
    </div>
  );
}

export function SkeletonChannelStrip() {
  return (
    <div className="overflow-x-auto scrollbar-hide px-4 py-3 flex gap-5 border-b border-yt-border">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex flex-col items-center gap-1.5 flex-shrink-0">
          <div className="skeleton w-12 h-12" style={{ borderRadius: '50%' }} />
          <div className="skeleton h-2.5 w-10 rounded" />
        </div>
      ))}
    </div>
  );
}
