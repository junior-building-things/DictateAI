import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement>;

function BaseIcon(props: IconProps) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    />
  );
}

export function MicIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 1 0 6 0V6a3 3 0 0 0-3-3Z" />
      <path d="M19 11a7 7 0 0 1-14 0" />
      <path d="M12 18v3" />
      <path d="M8 21h8" />
    </BaseIcon>
  );
}

export function HomeIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="m3 10 9-7 9 7" />
      <path d="M5 9.8V20h14V9.8" />
      <path d="M9 20v-6h6v6" />
    </BaseIcon>
  );
}

export function KeyboardIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <rect x="3" y="6" width="18" height="12" rx="2.5" />
      <path d="M7 10h.01M10 10h.01M13 10h.01M16 10h.01M7 13h.01M10 13h.01M13 13h4" />
    </BaseIcon>
  );
}

export function CpuIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <rect x="7" y="7" width="10" height="10" rx="2" />
      <path d="M9 1v3M15 1v3M9 20v3M15 20v3M20 9h3M20 15h3M1 9h3M1 15h3" />
      <path d="M10 10h4v4h-4z" />
    </BaseIcon>
  );
}

export function SparklesIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="M12 3 13.7 7.3 18 9l-4.3 1.7L12 15l-1.7-4.3L6 9l4.3-1.7L12 3Z" />
      <path d="M5 16 5.8 18.2 8 19l-2.2.8L5 22l-.8-2.2L2 19l2.2-.8L5 16Z" />
      <path d="M19 14 19.7 15.8 21.5 16.5l-1.8.7L19 19l-.7-1.8-1.8-.7 1.8-.7L19 14Z" />
    </BaseIcon>
  );
}

export function HistoryIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="M3 12a9 9 0 1 0 3-6.7" />
      <path d="M3 4v5h5" />
      <path d="M12 7v5l3 2" />
    </BaseIcon>
  );
}

export function ShieldIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="M12 3 5 6v5c0 4.5 2.8 8.6 7 10 4.2-1.4 7-5.5 7-10V6l-7-3Z" />
      <path d="m9.5 12 1.7 1.7 3.3-3.7" />
    </BaseIcon>
  );
}

export function GlobeIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18" />
      <path d="M12 3a15 15 0 0 1 0 18" />
      <path d="M12 3a15 15 0 0 0 0 18" />
    </BaseIcon>
  );
}

export function ArrowRightIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="M5 12h14" />
      <path d="m13 6 6 6-6 6" />
    </BaseIcon>
  );
}

export function WaveIcon(props: IconProps) {
  return (
    <BaseIcon {...props}>
      <path d="M3 12h2l1.5-4 3 8 2.5-8 2 5 1.5-3H21" />
    </BaseIcon>
  );
}
