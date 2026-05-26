import { Card, CardDescription, CardTitle } from "@/components/ui/card";
import { OpsView } from "@/components/dashboard/ops-view";
import { PageChrome } from "@/components/dashboard/shell";
import {
  CmoSystemPermissionError,
  requireOwnerOrAdminForSystem,
} from "@/lib/cmo/permissions";

export const dynamic = "force-dynamic";

function RestrictedOpsView({ role }: { role: string }) {
  return (
    <PageChrome
      title="Ops & Maintenance"
      description="System controls require owner or admin access"
      primary=""
    >
      <Card className="max-w-2xl border-orange-100 bg-orange-50/70 p-6">
        <CardTitle>Owner or admin required</CardTitle>
        <CardDescription className="mt-3 leading-6">
          Your current role is `{role}`. Normal workspace apps, CMO Chat, sessions,
          dashboards, and reviews remain available, but service/runtime controls are
          restricted.
        </CardDescription>
      </Card>
    </PageChrome>
  );
}

export default async function OpsPage() {
  try {
    await requireOwnerOrAdminForSystem();
  } catch (error) {
    if (error instanceof CmoSystemPermissionError) {
      return <RestrictedOpsView role={error.role} />;
    }

    throw error;
  }

  return <OpsView />;
}
