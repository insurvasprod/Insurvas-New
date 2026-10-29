/**
 * Third-party marks used next to "open in…" and "connect…" actions. Colours are spelled out the way
 * each brand gives them, so they stay correct in light and dark themes.
 */

export function GoogleMark({ className = "size-4 shrink-0" }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden="true">
      <path fill="rgb(255, 193, 7)" d="M43.6 20.1H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.6-.4-3.9z" />
      <path fill="rgb(255, 61, 0)" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="rgb(76, 175, 80)" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="rgb(25, 118, 210)" d="M43.6 20.1H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.6-.4-3.9z" />
    </svg>
  );
}

/** Gmail's envelope "M", simplified to four flat shapes. */
export function GmailMark({ className = "size-4 shrink-0" }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden="true">
      <path fill="rgb(66, 133, 244)" d="M6 40h7V22.5L4 16v20a4 4 0 0 0 2 4z" />
      <path fill="rgb(52, 168, 83)" d="M35 40h7a4 4 0 0 0 2-4V16l-9 6.5z" />
      <path fill="rgb(251, 188, 4)" d="M35 11v11.5l9-6.5v-3.5c0-3.7-4.2-5.8-7.2-3.6z" />
      <path fill="rgb(234, 67, 53)" d="M13 22.5V11l11 8.2L35 11v11.5L24 30.8z" />
      <path fill="rgb(197, 34, 31)" d="M4 12.5V16l9 6.5V11l-1.8-1.4C8.2 7.4 4 9.5 4 12.5z" />
    </svg>
  );
}

/** Outlook's mark, simplified: the blue tile with its O. */
export function OutlookMark({ className = "size-4 shrink-0" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <rect x="2" y="3" width="20" height="18" rx="3" fill="rgb(0, 120, 212)" />
      <ellipse cx="12" cy="12" rx="4.6" ry="5.2" fill="none" stroke="rgb(255, 255, 255)" strokeWidth="2.2" />
    </svg>
  );
}
