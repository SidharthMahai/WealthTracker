"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  if (pathname === "/login") {
    return <>{children}</>;
  }

  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <Link href="/" className="topbar-brand">
            WealthTracker
          </Link>
          <nav className="topbar-nav" aria-label="Primary">
            <Link
              href="/"
              className={`topbar-link ${pathname === "/" ? "is-active" : ""}`}
            >
              Investments
            </Link>
            <Link
              href="/budget"
              className={`topbar-link ${pathname === "/budget" ? "is-active" : ""}`}
            >
              Budget
            </Link>
          </nav>
        </div>
      </header>
      {children}
    </>
  );
}
