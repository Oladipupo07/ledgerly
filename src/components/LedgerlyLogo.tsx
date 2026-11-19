"use client";

import React from "react";

interface LedgerlyLogoProps {
  /** Size of the logomark icon in pixels */
  markSize?: number;
  /** Font size of the wordmark in pixels */
  fontSize?: number;
  /** Show only the icon mark without text */
  iconOnly?: boolean;
  /** Render the full high-res generated brand artwork banner */
  heroBanner?: boolean;
  /** Text color override (defaults to currentColor / brand navy) */
  textColor?: string;
}

export function LedgerlyMark({ size = 32 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 120 120"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      style={{ flexShrink: 0, display: "block" }}
    >
      {/* Left ledger spine column with window */}
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M16 30H42V96H45V103H13V96H16V30ZM24 37V46H34V37H24ZM24 53V96H34V53H24Z"
        fill="#127A59"
      />
      {/* Stylized serif-capped L */}
      <path
        d="M44 17H70V24H64V92H107V103H50V24H44V17Z"
        fill="#127A59"
      />
      {/* Ascending financial bars */}
      <rect x="70" y="45" width="15" height="27" fill="#127A59" />
      <rect x="90" y="29" width="15" height="43" fill="#127A59" />
      {/* Warm amber-gold balance bar */}
      <path
        d="M70 77H106V81C106 84.866 102.866 88 99 88H70V77Z"
        fill="#D9822B"
      />
    </svg>
  );
}

export function LedgerlyLogo({
  markSize = 32,
  fontSize = 21,
  iconOnly = false,
  heroBanner = false,
  textColor,
}: LedgerlyLogoProps) {
  if (heroBanner) {
    return (
      <div
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#F4F5F2",
          borderRadius: 14,
          padding: "8px 18px",
          border: "1px solid #E3E8E6",
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/ledgerly-logo.jpg"
          alt="Ledgerly"
          style={{
            height: markSize,
            width: "auto",
            maxWidth: "100%",
            objectFit: "contain",
            display: "block",
            borderRadius: 8,
          }}
        />
      </div>
    );
  }

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: Math.max(8, Math.round(markSize * 0.28)),
        lineHeight: 1,
      }}
    >
      <LedgerlyMark size={markSize} />
      {!iconOnly && (
        <span
          style={{
            fontWeight: 800,
            fontSize,
            letterSpacing: "-0.03em",
            color: textColor ?? "inherit",
          }}
        >
          ledgerly
        </span>
      )}
    </span>
  );
}

