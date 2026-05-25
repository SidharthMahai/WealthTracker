import { PortfolioDashboard } from "@/app/components/portfolio-dashboard";
import { getDashboardData } from "@/lib/portfolio";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const revalidate = 0;
export const fetchCache = "force-no-store";

export default async function HomePage() {
  const dashboard = await getDashboardData();

  return <PortfolioDashboard dashboard={dashboard} />;
}
