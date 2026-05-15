"use client";

import Link from "next/link";

import { icons } from "@/components/dashboard/icons";
import { PageChrome } from "@/components/dashboard/shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardTitle } from "@/components/ui/card";

export function RouteFallbackView({
  title,
  description,
  message,
  actions,
}: {
  title: string;
  description: string;
  message: string;
  actions?: React.ReactNode;
}) {
  return (
    <PageChrome
      title={title}
      description={description}
      actions={
        actions ?? (
          <>
            <Button asChild>
              <Link href="/apps">
                <icons.Grid2X2 />
                Apps
              </Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/">
                <icons.Home />
                Command Center
              </Link>
            </Button>
          </>
        )
      }
    >
      <Card className="p-7">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle>Content fallback</CardTitle>
            <CardDescription className="mt-2">
              The page shell is visible, but the workspace data could not be loaded.
            </CardDescription>
          </div>
          <Badge variant="orange">Fallback UI</Badge>
        </div>
        <div className="mt-5 rounded-xl border border-orange-100 bg-orange-50 px-4 py-3 text-sm font-medium text-orange-800">
          {message}
        </div>
      </Card>
    </PageChrome>
  );
}
