export default function Header() {
  return (
    <header className="border-b px-6 py-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-bold">Swixter</h1>
          <span className="text-sm text-muted-foreground">AI Coder Configuration Manager</span>
        </div>
        <div className="flex items-center gap-4">
          <a
            href="https://github.com/dawnswwwww/swixter"
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            GitHub
          </a>
        </div>
      </div>
    </header>
  );
}
