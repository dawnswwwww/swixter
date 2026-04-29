import { useLocation, Link } from "react-router-dom";

const routeLabels: Record<string, string> = {
  "/": "Dashboard",
  "/profiles": "Profiles",
  "/providers": "Providers",
  "/settings": "Settings",
};

export default function Header() {
  const location = useLocation();
  const currentLabel = routeLabels[location.pathname] || "Unknown";

  return (
    <header className="border-b border-zinc-800 px-8 py-5 bg-zinc-900/50">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          {/* Breadcrumb */}
          <nav className="flex items-center gap-2 text-sm font-mono">
            <Link to="/" className="text-zinc-500 hover:text-zinc-300 transition-colors">
              Home
            </Link>
            <span className="text-zinc-700">/</span>
            <span className="text-amber-400">{currentLabel}</span>
          </nav>
        </div>
        <div className="flex items-center gap-6">
          <a
            href="https://github.com/dawnswwwww/swixter"
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-zinc-500 hover:text-zinc-300 transition-colors font-mono"
          >
            GitHub
          </a>
        </div>
      </div>
    </header>
  );
}
