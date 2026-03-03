import { NavLink } from "react-router-dom";
import { classNames } from "../lib/utils";
import { useKeyboard } from "../hooks/useKeyboard";
import { BookOpen, Globe, Sparkles, ClipboardList, CalendarDays } from "./ui/Icon";

const tabs = [
  { to: "/", icon: BookOpen, label: "Recipes" },
  { to: "/discover", icon: Globe, label: "Discover" },
  { to: "/suggest", icon: Sparkles, label: "Suggest" },
  { to: "/list", icon: ClipboardList, label: "List" },
  { to: "/plan", icon: CalendarDays, label: "Plan" },
] as const;

export function BottomNav() {
  const { isKeyboardOpen } = useKeyboard();

  if (isKeyboardOpen) return null;

  return (
    <nav className="no-print fixed bottom-0 left-0 right-0 z-40 border-t border-stone-200 bg-white/95 backdrop-blur-sm dark:border-orange-500/10 dark:bg-stone-950/95 pb-[var(--sab)]">
      <div className="flex items-center justify-around">
        {tabs.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={tab.to === "/"}
            className={({ isActive }) =>
              classNames(
                "flex flex-1 flex-col items-center gap-0.5 py-2 text-xs font-medium transition-colors",
                isActive
                  ? "text-orange-500"
                  : "text-stone-500 dark:text-stone-400"
              )
            }
          >
            <tab.icon className="w-6 h-6" />
            <span>{tab.label}</span>
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
