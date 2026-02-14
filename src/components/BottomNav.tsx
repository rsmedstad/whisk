import { NavLink } from "react-router-dom";
import { classNames } from "../lib/utils";

const tabs = [
  { to: "/", icon: "\uD83D\uDCD6", label: "Recipes" },
  { to: "/identify", icon: "\uD83D\uDCF7", label: "Identify" },
  { to: "/suggest", icon: "\u2728", label: "Suggest" },
  { to: "/list", icon: "\uD83D\uDCCB", label: "List" },
  { to: "/plan", icon: "\uD83D\uDCC5", label: "Plan" },
] as const;

export function BottomNav() {
  return (
    <nav className="no-print fixed bottom-0 left-0 right-0 z-40 border-t border-stone-200 bg-white/95 backdrop-blur-sm dark:border-stone-700 dark:bg-stone-950/95 pb-[var(--sab)]">
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
            <span className="text-xl leading-none">{tab.icon}</span>
            <span>{tab.label}</span>
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
