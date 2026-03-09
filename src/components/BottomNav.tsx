import { NavLink } from "react-router-dom";
import { classNames } from "../lib/utils";
import { useKeyboard } from "../hooks/useKeyboard";
import { BookOpen, Globe, Sparkles, ShoppingCart, CalendarDays } from "./ui/Icon";

const tabs = [
  { to: "/", icon: BookOpen, label: "Recipes" },
  { to: "/discover", icon: Globe, label: "Discover" },
  { to: "/plan", icon: CalendarDays, label: "Plan" },
  { to: "/list", icon: ShoppingCart, label: "List" },
  { to: "/ask", icon: Sparkles, label: "Ask" },
] as const;

export function BottomNav() {
  const { isKeyboardOpen } = useKeyboard();

  return (
    <nav className={classNames(
      "no-print fixed bottom-0 inset-x-0 z-40 transition-transform duration-200",
      isKeyboardOpen && "translate-y-full"
    )}>
      <div className="max-w-6xl mx-auto border-t border-stone-200 bg-white/95 backdrop-blur-sm dark:border-orange-500/10 dark:bg-stone-950/95 pb-[var(--sab)]">
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
      </div>
    </nav>
  );
}
