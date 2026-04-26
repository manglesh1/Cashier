import React from 'react';

export function LogoMark({ size = 40 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 120 120" fill="none">
      <rect x="2" y="2" width="116" height="116" rx="28" fill="#1A1814"/>
      <circle cx="60" cy="74" r="30" stroke="#FFCF1F" strokeWidth="6"/>
      <path d="M60 24 L86 70 H73.5 L70.5 63 H49.5 L46.5 70 H34 L60 24 Z M54 53 H66 L60 39 L54 53 Z" fill="#F45B0A"/>
      <circle cx="60" cy="98" r="5" fill="#6A40F5"/>
    </svg>
  );
}
