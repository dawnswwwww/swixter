import { NavLink } from "react-router-dom";

interface NavItem {
  to: string;
  label: string;
}

const navItems: NavItem[] = [
  { to: "/", label: "Dashboard" },
  { to: "/profiles", label: "Profiles" },
  { to: "/providers", label: "Providers" },
  { to: "/settings", label: "Settings" },
];

export default function Sidebar() {
  return (
    <aside className="w-56 border-r border-zinc-800 bg-zinc-950 flex flex-col">
      {/* Logo */}
      <div className="p-6 border-b border-zinc-800">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded bg-amber-500 flex items-center justify-center">
            <span className="font-mono font-bold text-zinc-950 text-sm">SX</span>
          </div>
          <div>
            <h1 className="font-mono font-semibold text-zinc-100 tracking-tight">SWIXTER</h1>
            <p className="text-xs text-zinc-600 font-mono">v0.0.11</p>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 p-4">
        <div className="space-y-1">
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `block px-4 py-2.5 rounded text-sm font-medium transition-all duration-150 ${
                  isActive
                    ? "bg-amber-500/10 text-amber-400 border-l-2 border-amber-500 ml-[-2px] pl-[14px]"
                    : "text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900"
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </div>
      </nav>

      {/* Footer */}
      <div className="p-4 border-t border-zinc-800">
        <div className="flex items-center gap-2">
          <span className="status-dot status-dot--active"></span>
          <span className="text-xs text-zinc-600 font-mono">System Online</span>
        </div>
      </div>
    </aside>
  );
}
