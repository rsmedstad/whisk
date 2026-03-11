import type { SVGProps } from "react";

export type IconProps = SVGProps<SVGSVGElement>;

const defaults: IconProps = {
  xmlns: "http://www.w3.org/2000/svg",
  fill: "none",
  viewBox: "0 0 24 24",
  strokeWidth: 1.5,
  stroke: "currentColor",
};

function Icon({ className = "w-5 h-5", children, ...props }: IconProps) {
  return (
    <svg {...defaults} className={className} {...props}>
      {children}
    </svg>
  );
}

export function ChevronLeft(props: IconProps) {
  return (
    <Icon {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" />
    </Icon>
  );
}

export function ChevronRight(props: IconProps) {
  return (
    <Icon {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 4.5 7.5 7.5-7.5 7.5" />
    </Icon>
  );
}

export function BookOpen(props: IconProps) {
  return (
    <Icon {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25" />
    </Icon>
  );
}

export function Camera(props: IconProps) {
  return (
    <Icon {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6.827 6.175A2.31 2.31 0 0 1 5.186 7.23c-.38.054-.757.112-1.134.175C2.999 7.58 2.25 8.507 2.25 9.574V18a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18V9.574c0-1.067-.75-1.994-1.802-2.169a47.865 47.865 0 0 0-1.134-.175 2.31 2.31 0 0 1-1.64-1.055l-.822-1.316a2.192 2.192 0 0 0-1.736-1.039 48.774 48.774 0 0 0-5.232 0 2.192 2.192 0 0 0-1.736 1.039l-.821 1.316Z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 12.75a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0Z" />
    </Icon>
  );
}

export function Sparkles(props: IconProps) {
  return (
    <Icon {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904 9 18.75l-.813-2.846a4.5 4.5 0 0 0-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 0 0 3.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 0 0 3.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 0 0-3.09 3.09ZM18.259 8.715 18 9.75l-.259-1.035a3.375 3.375 0 0 0-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 0 0 2.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 0 0 2.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 0 0-2.455 2.456ZM16.894 20.567 16.5 21.75l-.394-1.183a2.25 2.25 0 0 0-1.423-1.423L13.5 18.75l1.183-.394a2.25 2.25 0 0 0 1.423-1.423l.394-1.183.394 1.183a2.25 2.25 0 0 0 1.423 1.423l1.183.394-1.183.394a2.25 2.25 0 0 0-1.423 1.423Z" />
    </Icon>
  );
}

export function ClipboardList(props: IconProps) {
  return (
    <Icon {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 0 0 2.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 0 0-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75 2.25 2.25 0 0 0-.1-.664m-5.8 0A2.251 2.251 0 0 1 13.5 2.25H15a2.25 2.25 0 0 1 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25ZM6.75 12h.008v.008H6.75V12Zm0 3h.008v.008H6.75V15Zm0 3h.008v.008H6.75V18Z" />
    </Icon>
  );
}

export function CalendarDays(props: IconProps) {
  return (
    <Icon {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5m-9-6h.008v.008H12v-.008ZM12 15h.008v.008H12V15Zm0 2.25h.008v.008H12v-.008ZM9.75 15h.008v.008H9.75V15Zm0 2.25h.008v.008H9.75v-.008ZM7.5 15h.008v.008H7.5V15Zm0 2.25h.008v.008H7.5v-.008Zm6.75-4.5h.008v.008h-.008v-.008Zm0 2.25h.008v.008h-.008V15Zm0 2.25h.008v.008h-.008v-.008Zm2.25-4.5h.008v.008H16.5v-.008Zm0 2.25h.008v.008H16.5V15Z" />
    </Icon>
  );
}

export function Cog(props: IconProps) {
  return (
    <Icon {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 0 1 1.37.49l1.296 2.247a1.125 1.125 0 0 1-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 0 1 0 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 0 1-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 0 1-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 0 1-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 0 1-1.369-.49l-1.297-2.247a1.125 1.125 0 0 1 .26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 0 1 0-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 0 1-.26-1.43l1.297-2.247a1.125 1.125 0 0 1 1.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28Z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
    </Icon>
  );
}

export function Plus(props: IconProps) {
  return (
    <Icon {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
    </Icon>
  );
}

export function Minus(props: IconProps) {
  return (
    <Icon {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 12h14" />
    </Icon>
  );
}

export function XMark(props: IconProps) {
  return (
    <Icon {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
    </Icon>
  );
}

export function Heart(props: IconProps) {
  return (
    <Icon {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12Z" />
    </Icon>
  );
}

export function HeartFilled(props: IconProps) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className={props.className ?? "w-5 h-5"} {...props}>
      <path d="m11.645 20.91-.007-.003-.022-.012a15.247 15.247 0 0 1-.383-.218 25.18 25.18 0 0 1-4.244-3.17C4.688 15.36 2.25 12.174 2.25 8.25 2.25 5.322 4.714 3 7.688 3A5.5 5.5 0 0 1 12 5.052 5.5 5.5 0 0 1 16.313 3c2.973 0 5.437 2.322 5.437 5.25 0 3.925-2.438 7.111-4.739 9.256a25.175 25.175 0 0 1-4.244 3.17 15.247 15.247 0 0 1-.383.219l-.022.012-.007.004-.003.001a.752.752 0 0 1-.704 0l-.003-.001Z" />
    </svg>
  );
}

export function Pencil(props: IconProps) {
  return (
    <Icon {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10" />
    </Icon>
  );
}

export function EllipsisVertical(props: IconProps) {
  return (
    <Icon {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.75a.75.75 0 1 1 0-1.5.75.75 0 0 1 0 1.5ZM12 12.75a.75.75 0 1 1 0-1.5.75.75 0 0 1 0 1.5ZM12 18.75a.75.75 0 1 1 0-1.5.75.75 0 0 1 0 1.5Z" />
    </Icon>
  );
}

export function Clock(props: IconProps) {
  return (
    <Icon {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
    </Icon>
  );
}

export function Hourglass(props: IconProps) {
  return (
    <Icon {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6l4 2M7.5 3h9M7.5 21h9M7.5 3v4.5a4.5 4.5 0 0 0 2.25 3.897L12 12.75l2.25-1.353A4.5 4.5 0 0 0 16.5 7.5V3M7.5 21v-4.5a4.5 4.5 0 0 1 2.25-3.897L12 11.25l2.25 1.353A4.5 4.5 0 0 1 16.5 16.5V21" />
    </Icon>
  );
}

export function Users(props: IconProps) {
  return (
    <Icon {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z" />
    </Icon>
  );
}

export function PlayCircle(props: IconProps) {
  return (
    <Icon {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM15.91 11.672a.375.375 0 0 1 0 .656l-5.603 3.113a.375.375 0 0 1-.557-.328V8.887c0-.286.307-.466.557-.327l5.603 3.112Z" />
    </Icon>
  );
}

export function SpeakerWave(props: IconProps) {
  return (
    <Icon {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.114 5.636a9 9 0 0 1 0 12.728M16.463 8.288a5.25 5.25 0 0 1 0 7.424M6.75 8.25l4.72-4.72a.75.75 0 0 1 1.28.53v15.88a.75.75 0 0 1-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.009 9.009 0 0 1 2.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75Z" />
    </Icon>
  );
}

export function Check(props: IconProps) {
  return (
    <Icon {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 12.75 6 6 9-13.5" />
    </Icon>
  );
}

export function ArrowUpDown(props: IconProps) {
  return (
    <Icon {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 7.5 7.5 3m0 0L12 7.5M7.5 3v13.5m13.5 0L16.5 21m0 0L12 16.5m4.5 4.5V7.5" />
    </Icon>
  );
}

export function ShoppingCart(props: IconProps) {
  return (
    <Icon {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 3h1.386c.51 0 .955.343 1.087.835l.383 1.437M7.5 14.25a3 3 0 0 0-3 3h15.75m-12.75-3h11.218c1.121-2.3 2.1-4.684 2.924-7.138a60.114 60.114 0 0 0-16.536-1.84M7.5 14.25 5.106 5.272M6 20.25a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Zm12.75 0a.75.75 0 1 1-1.5 0 .75.75 0 0 1 1.5 0Z" />
    </Icon>
  );
}

export function Inbox(props: IconProps) {
  return (
    <Icon {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 3.75H6.912a2.25 2.25 0 0 0-2.15 1.588L2.35 13.177a2.25 2.25 0 0 0-.1.661V18a2.25 2.25 0 0 0 2.25 2.25h15A2.25 2.25 0 0 0 21.75 18v-4.162c0-.224-.034-.447-.1-.661L19.24 5.338a2.25 2.25 0 0 0-2.15-1.588H15M2.25 13.5h3.86a2.25 2.25 0 0 1 2.012 1.244l.256.512a2.25 2.25 0 0 0 2.013 1.244h3.218a2.25 2.25 0 0 0 2.013-1.244l.256-.512a2.25 2.25 0 0 1 2.013-1.244h3.859M12 3v8.25m0 0-3-3m3 3 3-3" />
    </Icon>
  );
}

export function Globe(props: IconProps) {
  return (
    <Icon {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9.004 9.004 0 0 0 8.716-6.747M12 21a9.004 9.004 0 0 1-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 0 1 7.843 4.582M12 3a8.997 8.997 0 0 0-7.843 4.582m15.686 0A11.953 11.953 0 0 1 12 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0 1 21 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0 1 12 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 0 1 3 12c0-1.605.42-3.113 1.157-4.418" />
    </Icon>
  );
}

export function WhiskLogo(props: IconProps) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" className={props.className ?? "w-5 h-5"} {...props}>
      {/* Handle */}
      <line x1="12" y1="22" x2="12" y2="14.5" strokeWidth={2} />
      {/* Ferrule band */}
      <ellipse cx="12" cy="14.5" rx="2" ry="0.6" strokeWidth={1.5} />
      {/* Outer wire loop — slender */}
      <path d="M10 14.5 C5.5 11, 5.5 5, 12 2.5 C18.5 5, 18.5 11, 14 14.5" strokeWidth={1.2} />
      {/* Inner wire loop */}
      <path d="M11 14.5 C8 11.5, 8 6, 12 3.5 C16 6, 16 11.5, 13 14.5" strokeWidth={1} />
      {/* Center wire */}
      <line x1="12" y1="14.5" x2="12" y2="2.5" strokeWidth={0.8} />
    </svg>
  );
}

export function Fire(props: IconProps) {
  return (
    <Icon {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.362 5.214A8.252 8.252 0 0 1 12 21 8.25 8.25 0 0 1 6.038 7.047 8.287 8.287 0 0 0 9 9.601a8.983 8.983 0 0 1 3.361-6.867 8.21 8.21 0 0 0 3 2.48Z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 18a3.75 3.75 0 0 0 .495-7.468 5.99 5.99 0 0 0-1.925 3.547 5.975 5.975 0 0 1-2.133-1.001A3.75 3.75 0 0 0 12 18Z" />
    </Icon>
  );
}

export function Sunrise(props: IconProps) {
  return (
    <Icon {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v2.25m6.364.386-1.591 1.591M21 12h-2.25m-.386 6.364-1.591-1.591M12 18.75V21m-4.773-4.227-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0Z" />
    </Icon>
  );
}

export function ComputerDesktop(props: IconProps) {
  return (
    <Icon {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 17.25v1.007a3 3 0 0 1-.879 2.122L7.5 21h9l-.621-.621A3 3 0 0 1 15 18.257V17.25m6-12V15a2.25 2.25 0 0 1-2.25 2.25H5.25A2.25 2.25 0 0 1 3 15V5.25A2.25 2.25 0 0 1 5.25 3h13.5A2.25 2.25 0 0 1 21 5.25Z" />
    </Icon>
  );
}

export function Sun(props: IconProps) {
  return (
    <Icon {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v2.25m6.364.386-1.591 1.591M21 12h-2.25m-.386 6.364-1.591-1.591M12 18.75V21m-4.773-4.227-1.591 1.591M5.25 12H3m4.227-4.773L5.636 5.636M15.75 12a3.75 3.75 0 1 1-7.5 0 3.75 3.75 0 0 1 7.5 0Z" />
    </Icon>
  );
}

export function Moon(props: IconProps) {
  return (
    <Icon {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M21.752 15.002A9.72 9.72 0 0 1 18 15.75c-5.385 0-9.75-4.365-9.75-9.75 0-1.33.266-2.597.748-3.752A9.753 9.753 0 0 0 3 11.25C3 16.635 7.365 21 12.75 21a9.753 9.753 0 0 0 9.002-5.998Z" />
    </Icon>
  );
}

export function ChevronUp(props: IconProps) {
  return (
    <Icon {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" d="m4.5 15.75 7.5-7.5 7.5 7.5" />
    </Icon>
  );
}

export function ChevronDown(props: IconProps) {
  return (
    <Icon {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" d="m19.5 8.25-7.5 7.5-7.5-7.5" />
    </Icon>
  );
}

export function Trash(props: IconProps) {
  return (
    <Icon {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0" />
    </Icon>
  );
}

export function Link(props: IconProps) {
  return (
    <Icon {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 0 1 1.242 7.244l-4.5 4.5a4.5 4.5 0 0 1-6.364-6.364l1.757-1.757m13.35-.622 1.757-1.757a4.5 4.5 0 0 0-6.364-6.364l-4.5 4.5a4.5 4.5 0 0 0 1.242 7.244" />
    </Icon>
  );
}

export function Tag(props: IconProps) {
  return (
    <Icon {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.568 3H5.25A2.25 2.25 0 0 0 3 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 0 0 5.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 0 0 9.568 3Z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 6h.008v.008H6V6Z" />
    </Icon>
  );
}

export function Stopwatch(props: IconProps) {
  return (
    <Icon {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M10 2h4" />
    </Icon>
  );
}

export function Share(props: IconProps) {
  return (
    <Icon {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 8.25H7.5a2.25 2.25 0 0 0-2.25 2.25v9a2.25 2.25 0 0 0 2.25 2.25h9a2.25 2.25 0 0 0 2.25-2.25v-9a2.25 2.25 0 0 0-2.25-2.25H15m0-3-3-3m0 0-3 3m3-3v12" />
    </Icon>
  );
}

export function PencilSquare(props: IconProps) {
  return (
    <Icon {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" d="m16.862 4.487 1.687-1.688a1.875 1.875 0 1 1 2.652 2.652L10.582 16.07a4.5 4.5 0 0 1-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 0 1 1.13-1.897l8.932-8.931Zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0 1 15.75 21H5.25A2.25 2.25 0 0 1 3 18.75V8.25A2.25 2.25 0 0 1 5.25 6H10" />
    </Icon>
  );
}

export function RefreshCw(props: IconProps) {
  return (
    <Icon {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182M21.015 4.356v4.992" />
    </Icon>
  );
}

export function CalendarPlus(props: IconProps) {
  return (
    <Icon {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v4.5m-9-4.5h.008v.008H12V7.5ZM3 18.75A2.25 2.25 0 0 0 5.25 21h5.25m6-3v3m0 0v-3m0 3h3m-3 0h-3" />
    </Icon>
  );
}

export function Dice(props: IconProps) {
  return (
    <Icon {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 5.25a1.5 1.5 0 0 1 1.5-1.5h13.5a1.5 1.5 0 0 1 1.5 1.5v13.5a1.5 1.5 0 0 1-1.5 1.5H5.25a1.5 1.5 0 0 1-1.5-1.5V5.25Z" />
      <circle cx="8.25" cy="8.25" r="0.75" fill="currentColor" stroke="none" />
      <circle cx="15.75" cy="8.25" r="0.75" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="0.75" fill="currentColor" stroke="none" />
      <circle cx="8.25" cy="15.75" r="0.75" fill="currentColor" stroke="none" />
      <circle cx="15.75" cy="15.75" r="0.75" fill="currentColor" stroke="none" />
    </Icon>
  );
}

export function Leaf(props: IconProps) {
  return (
    <Icon {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 21c0 0-8-4-8-12 0-4.5 3.5-6 8-6s8 1.5 8 6c0 8-8 12-8 12Z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 21V9" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 13.5c1.5-1.5 3-2.5 4.5-3" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5c-1.5 1-3 2-4.5 2.5" />
    </Icon>
  );
}

/** Cherry-blossom style 5-petal flower for spring */
export function Flower(props: IconProps) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" className={props.className ?? "w-5 h-5"} {...props}>
      {/* 5 simple rounded petals radiating from center — clear outlines */}
      <ellipse cx="12" cy="5.5" rx="3" ry="4" strokeWidth={1.5} fill="currentColor" opacity={0.35} />
      <ellipse cx="17.5" cy="9.5" rx="3" ry="4" transform="rotate(72 17.5 9.5)" strokeWidth={1.5} fill="currentColor" opacity={0.35} />
      <ellipse cx="15.5" cy="15.5" rx="3" ry="4" transform="rotate(144 15.5 15.5)" strokeWidth={1.5} fill="currentColor" opacity={0.35} />
      <ellipse cx="8.5" cy="15.5" rx="3" ry="4" transform="rotate(-144 8.5 15.5)" strokeWidth={1.5} fill="currentColor" opacity={0.35} />
      <ellipse cx="6.5" cy="9.5" rx="3" ry="4" transform="rotate(-72 6.5 9.5)" strokeWidth={1.5} fill="currentColor" opacity={0.35} />
      {/* Center */}
      <circle cx="12" cy="10.5" r="2.2" strokeWidth={1.5} fill="currentColor" opacity={0.5} />
      {/* Stem */}
      <path d="M12 13 C12 16, 11.5 18, 12 21" strokeWidth={1.8} />
    </svg>
  );
}

export function Send(props: IconProps) {
  return (
    <Icon {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 12 3.269 3.125A59.769 59.769 0 0 1 21.485 12 59.768 59.768 0 0 1 3.27 20.875L5.999 12Zm0 0h7.5" />
    </Icon>
  );
}

/* ── Holiday-themed brand icons ──────────────────────────── */

/** Pumpkin icon for Halloween branding — classic round jack-o-lantern */
export function Pumpkin(props: IconProps) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" className={props.className ?? "w-5 h-5"} {...props}>
      {/* Stem */}
      <path d="M11 6 C10.5 4, 11 2.5, 12.5 2 C13 3, 13 4.5, 13 6" strokeWidth={1.5} />
      {/* Pumpkin body — wide oval */}
      <ellipse cx="12" cy="14" rx="9" ry="7.5" strokeWidth={1.5} />
      {/* Left crease */}
      <path d="M8 7.5 C6.5 10, 6.5 17, 8 20" strokeWidth={1} opacity={0.5} />
      {/* Right crease */}
      <path d="M16 7.5 C17.5 10, 17.5 17, 16 20" strokeWidth={1} opacity={0.5} />
      {/* Center crease */}
      <path d="M12 6.5 C12 9, 12 19, 12 21.5" strokeWidth={1} opacity={0.4} />
      {/* Left eye — triangle */}
      <path d="M8 12 L9.5 10 L11 12 Z" strokeWidth={1.2} fill="currentColor" opacity={0.7} />
      {/* Right eye — triangle */}
      <path d="M13 12 L14.5 10 L16 12 Z" strokeWidth={1.2} fill="currentColor" opacity={0.7} />
      {/* Mouth — jagged grin */}
      <path d="M8 15.5 L9.5 14.5 L11 15.5 L12 14.5 L13 15.5 L14.5 14.5 L16 15.5" strokeWidth={1.3} />
    </svg>
  );
}

/** Christmas tree for Christmas branding */
export function ChristmasTree(props: IconProps) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" className={props.className ?? "w-5 h-5"} {...props}>
      {/* Star */}
      <path d="M12 1 L12.8 3.5 L12 3 L11.2 3.5 Z" strokeWidth={1} fill="currentColor" />
      {/* Top tier */}
      <path d="M12 3 L8 8 L16 8 Z" strokeWidth={1.2} />
      {/* Middle tier */}
      <path d="M12 6 L6 13 L18 13 Z" strokeWidth={1.2} />
      {/* Bottom tier */}
      <path d="M12 10 L4 19 L20 19 Z" strokeWidth={1.2} />
      {/* Trunk */}
      <rect x="10" y="19" width="4" height="3" rx="0.5" strokeWidth={1.2} />
      {/* Ornaments */}
      <circle cx="10" cy="11" r="0.6" fill="currentColor" stroke="none" />
      <circle cx="14" cy="14" r="0.6" fill="currentColor" stroke="none" />
      <circle cx="9" cy="16" r="0.6" fill="currentColor" stroke="none" />
      <circle cx="15" cy="17" r="0.6" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** Snowflake for winter branding */
export function Snowflake(props: IconProps) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" className={props.className ?? "w-5 h-5"} {...props}>
      {/* Main axes */}
      <line x1="12" y1="2" x2="12" y2="22" strokeWidth={1.5} />
      <line x1="3.34" y1="7" x2="20.66" y2="17" strokeWidth={1.5} />
      <line x1="3.34" y1="17" x2="20.66" y2="7" strokeWidth={1.5} />
      {/* Top branches */}
      <path d="M12 2 L10 4.5 M12 2 L14 4.5" strokeWidth={1.2} />
      {/* Bottom branches */}
      <path d="M12 22 L10 19.5 M12 22 L14 19.5" strokeWidth={1.2} />
      {/* Upper-right branches */}
      <path d="M20.66 7 L17.8 7.2 M20.66 7 L19.5 9.5" strokeWidth={1.2} />
      {/* Lower-right branches */}
      <path d="M20.66 17 L19.5 14.5 M20.66 17 L17.8 16.8" strokeWidth={1.2} />
      {/* Lower-left branches */}
      <path d="M3.34 17 L4.5 14.5 M3.34 17 L6.2 16.8" strokeWidth={1.2} />
      {/* Upper-left branches */}
      <path d="M3.34 7 L6.2 7.2 M3.34 7 L4.5 9.5" strokeWidth={1.2} />
      {/* Center diamond */}
      <circle cx="12" cy="12" r="1.5" strokeWidth={1} />
    </svg>
  );
}

/** Heart with arrow for Valentine's Day branding */
export function HeartArrow(props: IconProps) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" className={props.className ?? "w-5 h-5"} {...props}>
      {/* Heart */}
      <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" strokeWidth={1.5} />
      {/* Arrow */}
      <line x1="4" y1="4" x2="19" y2="16" strokeWidth={1.2} />
      <path d="M19 16 L16 15.5 M19 16 L18.5 13" strokeWidth={1.5} />
    </svg>
  );
}

/** Shamrock/clover for St. Patrick's Day — bold 3-leaf clover */
export function Shamrock(props: IconProps) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" className={props.className ?? "w-5 h-5"} {...props}>
      {/* Top leaf — heart pointing up */}
      <path d="M12 11 C11 9, 9.5 6, 9.5 4.5 C9.5 2.5, 11 1.5, 12 3 C13 1.5, 14.5 2.5, 14.5 4.5 C14.5 6, 13 9, 12 11Z" strokeWidth={1.5} fill="currentColor" opacity={0.4} />
      {/* Bottom-left leaf — heart pointing lower-left */}
      <path d="M12 11 C10 10, 7 9.5, 5.5 10 C3.5 10.5, 3 8.5, 4.5 7.5 C3 6.5, 4 5, 6 5.5 C7.5 6, 10 8, 12 11Z" strokeWidth={1.5} fill="currentColor" opacity={0.4} />
      {/* Bottom-right leaf — heart pointing lower-right */}
      <path d="M12 11 C14 10, 17 9.5, 18.5 10 C20.5 10.5, 21 8.5, 19.5 7.5 C21 6.5, 20 5, 18 5.5 C16.5 6, 14 8, 12 11Z" strokeWidth={1.5} fill="currentColor" opacity={0.4} />
      {/* Leaf veins */}
      <line x1="12" y1="11" x2="12" y2="4" strokeWidth={0.8} opacity={0.5} />
      <line x1="12" y1="11" x2="6" y2="7.5" strokeWidth={0.8} opacity={0.5} />
      <line x1="12" y1="11" x2="18" y2="7.5" strokeWidth={0.8} opacity={0.5} />
      {/* Stem */}
      <path d="M12 11 C12.5 14, 11.5 17, 12 21" strokeWidth={2} />
    </svg>
  );
}

/** Easter egg for Easter branding */
export function EasterEgg(props: IconProps) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" className={props.className ?? "w-5 h-5"} {...props}>
      {/* Egg shape */}
      <path d="M12 2 C7.5 2, 4 8, 4 14 C4 19, 7.5 22, 12 22 C16.5 22, 20 19, 20 14 C20 8, 16.5 2, 12 2Z" strokeWidth={1.3} />
      {/* Zigzag decoration band */}
      <path d="M5.5 10 L7.5 8 L9.5 10 L11.5 8 L13.5 10 L15.5 8 L17.5 10" strokeWidth={1.2} />
      {/* Wavy decoration band */}
      <path d="M6 15 C7.5 13.5, 9 16, 12 14.5 C15 13, 16.5 16, 18 15" strokeWidth={1.2} />
      {/* Dots */}
      <circle cx="9" cy="12" r="0.6" fill="currentColor" stroke="none" />
      <circle cx="15" cy="12" r="0.6" fill="currentColor" stroke="none" />
      <circle cx="12" cy="18" r="0.6" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** Firework/sparkler for 4th of July branding */
export function Firework(props: IconProps) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" className={props.className ?? "w-5 h-5"} {...props}>
      {/* Center burst */}
      <circle cx="12" cy="10" r="1" fill="currentColor" strokeWidth={0} />
      {/* Rays */}
      <line x1="12" y1="10" x2="12" y2="3" strokeWidth={1.5} />
      <line x1="12" y1="10" x2="17" y2="5" strokeWidth={1.3} />
      <line x1="12" y1="10" x2="19" y2="10" strokeWidth={1.3} />
      <line x1="12" y1="10" x2="17" y2="15" strokeWidth={1.3} />
      <line x1="12" y1="10" x2="7" y2="15" strokeWidth={1.3} />
      <line x1="12" y1="10" x2="5" y2="10" strokeWidth={1.3} />
      <line x1="12" y1="10" x2="7" y2="5" strokeWidth={1.3} />
      {/* Sparkle tips */}
      <circle cx="12" cy="3" r="0.5" fill="currentColor" stroke="none" />
      <circle cx="17" cy="5" r="0.5" fill="currentColor" stroke="none" />
      <circle cx="19" cy="10" r="0.5" fill="currentColor" stroke="none" />
      <circle cx="7" cy="5" r="0.5" fill="currentColor" stroke="none" />
      <circle cx="5" cy="10" r="0.5" fill="currentColor" stroke="none" />
      {/* Stick */}
      <line x1="12" y1="13" x2="12" y2="22" strokeWidth={1.5} />
    </svg>
  );
}

/** Turkey for Thanksgiving branding — recognizable bird silhouette */
export function TurkeyLeg(props: IconProps) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" className={props.className ?? "w-5 h-5"} {...props}>
      {/* Fan tail feathers */}
      <path d="M6 4 C6 4, 4 8, 6 12" strokeWidth={1.3} />
      <path d="M8 2.5 C8 2.5, 7 7, 8 12" strokeWidth={1.3} />
      <path d="M10.5 2 C10.5 2, 10 7, 10 12" strokeWidth={1.3} />
      <path d="M13 2.5 C13 2.5, 13 7, 12 12" strokeWidth={1.3} />
      <path d="M15 4 C15 4, 16 8, 14 12" strokeWidth={1.3} />
      {/* Body */}
      <ellipse cx="10" cy="15" rx="6" ry="4.5" strokeWidth={1.4} />
      {/* Head and neck */}
      <path d="M16 13 C18 11, 19 9, 18.5 7.5" strokeWidth={1.4} />
      <circle cx="18.5" cy="7" r="1.2" strokeWidth={1.3} />
      {/* Wattle */}
      <path d="M19.5 7.5 C20 8.5, 19.5 9.5, 19 9" strokeWidth={1.2} />
      {/* Beak */}
      <path d="M17.3 6.8 L16 6.5" strokeWidth={1.3} />
      {/* Legs */}
      <line x1="8" y1="19" x2="7" y2="22" strokeWidth={1.3} />
      <line x1="12" y1="19" x2="13" y2="22" strokeWidth={1.3} />
      {/* Feet */}
      <path d="M5.5 22 L7 22 L8 22" strokeWidth={1.2} />
      <path d="M12 22 L13 22 L14.5 22" strokeWidth={1.2} />
    </svg>
  );
}

/** Spider for Halloween decorative accent */
export function Spider(props: IconProps) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" className={props.className ?? "w-5 h-5"} {...props}>
      {/* Web thread */}
      <line x1="12" y1="1" x2="12" y2="8" strokeWidth={0.8} />
      {/* Body */}
      <ellipse cx="12" cy="10" rx="2.5" ry="2" strokeWidth={1.3} fill="currentColor" opacity={0.3} />
      <ellipse cx="12" cy="14" rx="3" ry="3.5" strokeWidth={1.3} fill="currentColor" opacity={0.3} />
      {/* Legs — left */}
      <path d="M9.5 10 C7 8, 4 6, 2 5" strokeWidth={1.1} />
      <path d="M9.5 11 C7 10, 4 10, 2 9" strokeWidth={1.1} />
      <path d="M9.5 13 C7 14, 4 16, 2 18" strokeWidth={1.1} />
      <path d="M9.5 14.5 C7 16, 4 18, 3 21" strokeWidth={1.1} />
      {/* Legs — right */}
      <path d="M14.5 10 C17 8, 20 6, 22 5" strokeWidth={1.1} />
      <path d="M14.5 11 C17 10, 20 10, 22 9" strokeWidth={1.1} />
      <path d="M14.5 13 C17 14, 20 16, 22 18" strokeWidth={1.1} />
      <path d="M14.5 14.5 C17 16, 20 18, 21 21" strokeWidth={1.1} />
      {/* Eyes */}
      <circle cx="11" cy="9.5" r="0.5" fill="currentColor" stroke="none" />
      <circle cx="13" cy="9.5" r="0.5" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function MessageCircle(props: IconProps) {
  return (
    <Icon {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 12a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H8.25m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0H12m4.125 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 0 1-2.555-.337A5.972 5.972 0 0 1 5.41 20.97a5.969 5.969 0 0 1-.474-.065 4.48 4.48 0 0 0 .978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25Z" />
    </Icon>
  );
}

export function MagnifyingGlass(props: IconProps) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={props.strokeWidth ?? 1.5} stroke="currentColor" className={props.className ?? "w-5 h-5"} {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z" />
    </svg>
  );
}

/** Filter funnel icon for list filtering */
export function Filter(props: IconProps) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={props.strokeWidth ?? 1.5} stroke="currentColor" className={props.className ?? "w-5 h-5"} {...props}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 3c2.755 0 5.455.232 8.083.678.533.09.917.556.917 1.096v1.044a2.25 2.25 0 0 1-.659 1.591l-5.432 5.432a2.25 2.25 0 0 0-.659 1.591v2.927a2.25 2.25 0 0 1-1.244 2.013L9.75 21v-6.568a2.25 2.25 0 0 0-.659-1.591L3.659 7.409A2.25 2.25 0 0 1 3 5.818V4.774c0-.54.384-1.006.917-1.096A48.32 48.32 0 0 1 12 3Z" />
    </svg>
  );
}

/** Witch hat for Halloween decorative accent */
export function WitchHat(props: IconProps) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" className={props.className ?? "w-5 h-5"} {...props}>
      {/* Hat cone */}
      <path d="M12 1 L7 16 L17 16 Z" strokeWidth={1.3} />
      {/* Brim */}
      <path d="M3 16 C3 16, 5 19, 12 19 C19 19, 21 16, 21 16" strokeWidth={1.5} />
      <line x1="3" y1="16" x2="7" y2="16" strokeWidth={1.3} />
      <line x1="17" y1="16" x2="21" y2="16" strokeWidth={1.3} />
      {/* Hat band */}
      <line x1="7.8" y1="14" x2="16.2" y2="14" strokeWidth={1.5} />
      {/* Buckle */}
      <rect x="10.5" y="13" width="3" height="2.5" rx="0.3" strokeWidth={1} />
    </svg>
  );
}
