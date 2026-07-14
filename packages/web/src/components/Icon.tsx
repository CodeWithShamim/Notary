import type { SVGProps } from 'react';

/**
 * A small, self-contained icon set drawn in a consistent line style
 * (24×24 grid, 1.8 stroke, rounded joins, `currentColor`). Keeping the
 * icons inline — like {@link ThemeToggle} and the wallet glyphs — avoids a
 * runtime dependency while giving the whole site one coherent, professional
 * look. Every icon inherits its color from the surrounding text.
 */

export type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function Base({ size = 24, children, ...rest }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  );
}

/* ── Navigation ─────────────────────────────────────────────── */

export const HomeIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M3 10.5 12 3l9 7.5" />
    <path d="M5 9.5V20a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9.5" />
    <path d="M9.5 21v-6h5v6" />
  </Base>
);

export const PlusCircleIcon = (p: IconProps) => (
  <Base {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 8.2v7.6M8.2 12h7.6" />
  </Base>
);

export const FileTextIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
    <path d="M14 3v5h5" />
    <path d="M9 13h6M9 17h6" />
  </Base>
);

export const LayersIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="m12 3 9 5-9 5-9-5 9-5Z" />
    <path d="m3 13 9 5 9-5" />
  </Base>
);

export const BotIcon = (p: IconProps) => (
  <Base {...p}>
    <rect x="4" y="8" width="16" height="12" rx="2.5" />
    <path d="M12 8V4M9.5 4h5" />
    <path d="M9 13.5h.01M15 13.5h.01" strokeWidth={2.6} />
    <path d="M2 13v3M22 13v3" />
  </Base>
);

export const BookIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z" />
    <path d="M4 20.5A2.5 2.5 0 0 1 6.5 18H20v3H6.5A2.5 2.5 0 0 1 4 18.5" />
    <path d="M9 7.5h7M9 11h7" />
  </Base>
);

/* ── Landing feature glyphs ─────────────────────────────────── */

export const KeyIcon = (p: IconProps) => (
  <Base {...p}>
    <circle cx="8" cy="15" r="4" />
    <path d="m10.9 12.1 8.1-8.1" />
    <path d="m17 5 2.5 2.5M14.5 7.5 17 10" />
  </Base>
);

export const CogIcon = (p: IconProps) => (
  <Base {...p}>
    <circle cx="12" cy="12" r="3.2" />
    <path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M19.1 4.9 17 7M7 17l-2.1 2.1" />
  </Base>
);

export const LockIcon = (p: IconProps) => (
  <Base {...p}>
    <rect x="4.5" y="10" width="15" height="10" rx="2.2" />
    <path d="M8 10V7a4 4 0 0 1 8 0v3" />
  </Base>
);

export const ReceiptIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M5 3h14v18l-2.3-1.4L14.3 21 12 19.6 9.7 21 7.3 19.6 5 21Z" />
    <path d="M9 8h6M9 12h6" />
  </Base>
);

/* ── Utility & status ───────────────────────────────────────── */

export const SearchIcon = (p: IconProps) => (
  <Base {...p}>
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.6-3.6" />
  </Base>
);

export const InboxIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M22 12h-6l-2 3h-4l-2-3H2" />
    <path d="M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
  </Base>
);

export const FileQuestionIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
    <path d="M14 3v5h5" />
    <path d="M10 13a2 2 0 1 1 3 1.7c-.7.4-1 .8-1 1.6" />
    <path d="M12 18.5h.01" strokeWidth={2.4} />
  </Base>
);

export const CheckIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="m5 12.5 4.5 4.5L19 7" />
  </Base>
);

export const CloseIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M6 6l12 12M18 6 6 18" />
  </Base>
);

export const CopyIcon = (p: IconProps) => (
  <Base {...p}>
    <rect x="8" y="8" width="12" height="12" rx="2.2" />
    <path d="M4 16a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2" />
  </Base>
);

export const ClockIcon = (p: IconProps) => (
  <Base {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3.5 2" />
  </Base>
);

export const ArrowRightIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M4 12h15M13.5 6l6 6-6 6" />
  </Base>
);

/* ── Social ─────────────────────────────────────────────────── */

export const GithubIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M9 19c-4.3 1.4-4.3-2.5-6-3m12 5v-3.5c0-1 .1-1.4-.5-2 2.8-.3 5.5-1.4 5.5-6a4.6 4.6 0 0 0-1.3-3.2 4.2 4.2 0 0 0-.1-3.2s-1.1-.3-3.5 1.3a12 12 0 0 0-6.2 0C6.5 2.8 5.4 3.1 5.4 3.1a4.2 4.2 0 0 0-.1 3.2A4.6 4.6 0 0 0 4 9.5c0 4.6 2.7 5.7 5.5 6-.6.6-.6 1.2-.5 2V21" />
  </Base>
);

export const XIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M4 4l7.5 9.3L4.3 20h1.8l5.7-6L16.5 20H20l-7.9-9.8L19.5 4h-1.8l-5.3 5.6L7.5 4Z" />
  </Base>
);

export const DiscordIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M18 6.2A16 16 0 0 0 14 5l-.5 1a12 12 0 0 0-3 0L10 5a16 16 0 0 0-4 1.2C3.5 10 3 13.7 3.2 17.3A15 15 0 0 0 7.5 19l.9-1.4a9 9 0 0 1-1.5-.7l.4-.3a10.6 10.6 0 0 0 9.4 0l.4.3a9 9 0 0 1-1.5.7l.9 1.4a15 15 0 0 0 4.3-1.7c.3-4.2-.5-7.9-2.8-11.1Z" />
    <path d="M9 13.5h.01M15 13.5h.01" strokeWidth={2.6} />
  </Base>
);

/** Scale of justice — the notary brand seal. */
export const ScaleIcon = (p: IconProps) => (
  <Base {...p}>
    <path d="M12 3v18M7 21h10" />
    <path d="M3 7h2c2 0 5-1 7-2 2 1 5 2 7 2h2" />
    <path d="m16 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z" />
    <path d="m2 16 3-8 3 8c-.87.65-1.92 1-3 1s-2.13-.35-3-1Z" />
  </Base>
);
