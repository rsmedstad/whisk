import { NavLink } from "react-router-dom";
import { classNames } from "../lib/utils";
import { useKeyboard } from "../hooks/useKeyboard";
import { BookOpen, Globe, Sparkles, ShoppingCart, CalendarDays } from "./ui/Icon";

const tabs = [
  { to: "/discover", icon: Globe, label: "Discover" },
  { to: "/", icon: BookOpen, label: "Recipes" },
  { to: "/ask", icon: Sparkles, label: "Ask", center: true as const },
  { to: "/plan", icon: CalendarDays, label: "Plan" },
  { to: "/list", icon: ShoppingCart, label: "List" },
];

export function BottomNav() {
  const { isKeyboardOpen } = useKeyboard();
  return (
    <nav className={classNames(
      "no-print fixed bottom-0 inset-x-0 z-40 transition-transform duration-200",
      isKeyboardOpen && "translate-y-full"
    )}>
      <div className="max-w-6xl mx-auto border-t border-stone-200 bg-white/95 backdrop-blur-sm dark:border-orange-500/10 dark:bg-stone-950/95 pb-[var(--sab)]">
        <div className="flex items-center">
          {tabs.map((tab) => {
            const isCenter = "center" in tab && tab.center;
            return (
              <NavLink
                key={tab.to}
                to={tab.to}
                end={tab.to === "/"}
                className="flex-1 min-w-0"
              >
                {({ isActive }) => (
                  <div className={classNames(
                    "flex flex-col items-center text-xs font-medium transition-colors",
                    isCenter ? "gap-0 py-1" : "gap-0.5 py-2",
                    isActive
                      ? "text-orange-500"
                      : "text-stone-500 dark:text-stone-400"
                  )}>
                    {isCenter ? (
                      <span className={classNames(
                        "flex items-center justify-center w-10 h-10 -mt-3 rounded-full shadow-md transition-colors",
                        isActive
                          ? "bg-orange-500 text-white shadow-orange-500/20"
                          : "bg-stone-200 text-stone-500 shadow-stone-200/20 dark:bg-stone-700 dark:text-stone-400 dark:shadow-stone-700/20"
                      )}>
                        <tab.icon className="w-5 h-5" />
                      </span>
                    ) : (
                      <tab.icon className="w-6 h-6" />
                    )}
                    <span>{tab.label}</span>
                  </div>
                )}
              </NavLink>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
