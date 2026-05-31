import { BudgetPlanner } from "@/app/components/budget-planner";
import { getBudgetPlannerData } from "@/lib/budget";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const revalidate = 0;
export const fetchCache = "force-no-store";

export default async function BudgetPage() {
  const budget = await getBudgetPlannerData();

  return <BudgetPlanner budget={budget} />;
}
