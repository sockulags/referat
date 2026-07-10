// Hand-drawn, stroke-based icons. Consistent 1.5px stroke, 24px grid, currentColor.
// No icon library — see file ownership rules.
import type { JSX, SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement> & { size?: number }

function Base({
  size = 20,
  children,
  ...props
}: IconProps & { children: React.ReactNode }): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  )
}

export const IconSettings = (p: IconProps): JSX.Element => (
  <Base {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 2.5v2M12 19.5v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M2.5 12h2M19.5 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4" />
  </Base>
)

export const IconMic = (p: IconProps): JSX.Element => (
  <Base {...p}>
    <rect x="9" y="2.5" width="6" height="11" rx="3" />
    <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M9 21h6" />
  </Base>
)

export const IconWave = (p: IconProps): JSX.Element => (
  <Base {...p}>
    <path d="M3 12h1.5M20.5 12H22M6.5 8.5v7M10 5v14M14 7v10M17.5 9.5v5" />
  </Base>
)

export const IconPlay = (p: IconProps): JSX.Element => (
  <Base {...p}>
    <path d="M7 5.5v13l11-6.5-11-6.5Z" />
  </Base>
)

export const IconPause = (p: IconProps): JSX.Element => (
  <Base {...p}>
    <path d="M8.5 5v14M15.5 5v14" />
  </Base>
)

export const IconStop = (p: IconProps): JSX.Element => (
  <Base {...p}>
    <rect x="6" y="6" width="12" height="12" rx="2.5" />
  </Base>
)

export const IconCheck = (p: IconProps): JSX.Element => (
  <Base {...p}>
    <path d="M4.5 12.5 9 17l10.5-10.5" />
  </Base>
)

export const IconX = (p: IconProps): JSX.Element => (
  <Base {...p}>
    <path d="M6 6l12 12M18 6 6 18" />
  </Base>
)

export const IconChevronDown = (p: IconProps): JSX.Element => (
  <Base {...p}>
    <path d="M6 9.5l6 6 6-6" />
  </Base>
)

export const IconChevronRight = (p: IconProps): JSX.Element => (
  <Base {...p}>
    <path d="M9.5 6l6 6-6 6" />
  </Base>
)

export const IconSearch = (p: IconProps): JSX.Element => (
  <Base {...p}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="M20 20l-3.6-3.6" />
  </Base>
)

export const IconCopy = (p: IconProps): JSX.Element => (
  <Base {...p}>
    <rect x="9" y="9" width="11" height="11" rx="2.5" />
    <path d="M15 5.5A2.5 2.5 0 0 0 12.5 3h-6A2.5 2.5 0 0 0 4 5.5v6A2.5 2.5 0 0 0 6.5 14" />
  </Base>
)

export const IconDownload = (p: IconProps): JSX.Element => (
  <Base {...p}>
    <path d="M12 3v12M7.5 10.5 12 15l4.5-4.5M4.5 20h15" />
  </Base>
)

export const IconTrash = (p: IconProps): JSX.Element => (
  <Base {...p}>
    <path d="M4 6.5h16M9.5 6.5V4.5h5v2M6.5 6.5 7.5 20h9l1-13.5M10 10v6M14 10v6" />
  </Base>
)

export const IconPencil = (p: IconProps): JSX.Element => (
  <Base {...p}>
    <path d="M14.5 5.5 18.5 9.5M4 20l1-4L16 5a2 2 0 0 1 3 3L8 19l-4 1Z" />
  </Base>
)

export const IconArrowLeft = (p: IconProps): JSX.Element => (
  <Base {...p}>
    <path d="M20 12H4M10 6 4 12l6 6" />
  </Base>
)

export const IconAlert = (p: IconProps): JSX.Element => (
  <Base {...p}>
    <path d="M12 3.5 22 20H2L12 3.5Z" />
    <path d="M12 10v4.5M12 17.5h.01" />
  </Base>
)

export const IconLaptop = (p: IconProps): JSX.Element => (
  <Base {...p}>
    <rect x="4" y="5" width="16" height="11" rx="2" />
    <path d="M2.5 20h19" />
  </Base>
)

export const IconServer = (p: IconProps): JSX.Element => (
  <Base {...p}>
    <rect x="3.5" y="4" width="17" height="7" rx="2" />
    <rect x="3.5" y="13" width="17" height="7" rx="2" />
    <path d="M7 7.5h.01M7 16.5h.01" />
  </Base>
)

export const IconCloud = (p: IconProps): JSX.Element => (
  <Base {...p}>
    <path d="M7 18.5A4.5 4.5 0 0 1 6.6 9.6a5.5 5.5 0 0 1 10.7-1A4 4 0 0 1 17 18.5H7Z" />
  </Base>
)

export const IconSun = (p: IconProps): JSX.Element => (
  <Base {...p}>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2.5v2M12 19.5v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M2.5 12h2M19.5 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4" />
  </Base>
)

export const IconMoon = (p: IconProps): JSX.Element => (
  <Base {...p}>
    <path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5Z" />
  </Base>
)

export const IconMonitor = (p: IconProps): JSX.Element => (
  <Base {...p}>
    <rect x="3" y="4" width="18" height="12" rx="2" />
    <path d="M8.5 20h7M12 16v4" />
  </Base>
)

export const IconRetry = (p: IconProps): JSX.Element => (
  <Base {...p}>
    <path d="M4 12a8 8 0 1 1 2.3 5.6" />
    <path d="M4 20v-4h4" />
  </Base>
)

export const IconClock = (p: IconProps): JSX.Element => (
  <Base {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 2" />
  </Base>
)

export const IconSpinner = (p: IconProps): JSX.Element => (
  <Base {...p}>
    <path d="M12 3.5a8.5 8.5 0 1 0 8.5 8.5" opacity={0.9} />
  </Base>
)

/** Brand mark — a stylized quote/soundwave turning into text lines. */
export const Wordmark = ({ size = 22 }: { size?: number }): JSX.Element => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path
      d="M4 8.5v7M8 5v14M12 8v8M16 10.5v3"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
    />
    <circle cx="20" cy="12" r="1.6" fill="currentColor" />
  </svg>
)
