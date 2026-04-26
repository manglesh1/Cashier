import React from 'react';
import { Icon } from './Icon';

export function StatusPill({ tone = "neutral", icon, children, pulse }) {
  const tones = {
    neutral: { bg: "var(--ink-100)", fg: "var(--ink-700)", dot: "var(--ink-500)" },
    success: { bg: "#DDF3E3", fg: "#0e6638", dot: "#1F9D55" },
    warning: { bg: "#FFF1CC", fg: "#7a5400", dot: "#E9A100" },
    danger:  { bg: "#FCE2DA", fg: "#8c2410", dot: "#D6361A" },
    info:    { bg: "#D2F1F4", fg: "#08555e", dot: "#18B8C9" },
    member:  { bg: "var(--aero-electric-50)", fg: "var(--aero-electric-500)", dot: "var(--aero-electric-400)" },
  }[tone] || {};

  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 8,
      padding: "6px 12px", borderRadius: 999,
      background: tones.bg, color: tones.fg,
      fontSize: 12, fontWeight: 700, letterSpacing: ".04em", textTransform: "uppercase",
      border: `1px solid ${tones.dot}`,
    }}>
      {pulse && (
        <span style={{
          width: 8, height: 8, borderRadius: "50%", background: tones.dot,
          animation: "ap-pulse 1.6s infinite",
        }}/>
      )}
      {icon && <Icon name={icon} size={12} />}
      {children}
    </span>
  );
}
