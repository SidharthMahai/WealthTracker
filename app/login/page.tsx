import { LoginForm } from "@/app/login/login-form";
import { ThemeInit } from "@/app/login/theme-init";

export const dynamic = "force-dynamic";

function resolveNextPath(value: unknown) {
  const raw = typeof value === "string" ? value : "";
  if (!raw) return "/";
  if (!raw.startsWith("/")) return "/";
  if (raw.startsWith("//")) return "/";
  return raw;
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const resolved = searchParams ? await searchParams : undefined;
  const nextPath = resolveNextPath(resolved?.next);

  return (
    <main className="auth-shell">
      <ThemeInit />

      <section className="panel auth-card" aria-label="Login">
        <div className="auth-layout">
          <aside className="auth-aside">
            <div className="login-pill">Private</div>
            <h1 className="login-title">WealthTracker</h1>
            <p className="muted auth-subtitle">
              Excel-backed investment dashboard for holdings, transactions, NAV trends,
              and allocation.
            </p>

            <div className="auth-kpis" aria-hidden="true">
              <div className="auth-kpi">
                <span className="auth-kpi-label">Workbook</span>
                <strong className="auth-kpi-value">Single source of truth</strong>
              </div>
              <div className="auth-kpi">
                <span className="auth-kpi-label">Views</span>
                <strong className="auth-kpi-value">Charts + transactions</strong>
              </div>
              <div className="auth-kpi">
                <span className="auth-kpi-label">Security</span>
                <strong className="auth-kpi-value">Password gate</strong>
              </div>
            </div>

            <ul className="auth-bullets">
              <li>Current value, profit/loss, and return snapshots</li>
              <li>Transaction history with filters and inline edits</li>
              <li>NAV history chart per fund</li>
              <li>Workbook viewer in the browser</li>
            </ul>

            <p className="muted auth-footnote">
              Tip: your session stays unlocked on this device for ~30 days.
            </p>
          </aside>

          <div className="auth-divider" aria-hidden="true" />

          <div className="auth-form">
            <h2 className="auth-form-title">Unlock dashboard</h2>
            <p className="muted">Enter password to continue.</p>
            <LoginForm nextPath={nextPath} />
          </div>
        </div>
      </section>
    </main>
  );
}
