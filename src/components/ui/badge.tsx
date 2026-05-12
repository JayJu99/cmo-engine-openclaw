import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-lg border px-2.5 py-1 text-xs font-semibold",
  {
    variants: {
      variant: {
        default: "border-indigo-100 bg-indigo-50 text-indigo-700",
        green: "border-emerald-100 bg-emerald-50 text-emerald-700",
        orange: "border-orange-100 bg-orange-50 text-orange-700",
        red: "border-red-100 bg-red-50 text-red-700",
        blue: "border-blue-100 bg-blue-50 text-blue-700",
        slate: "border-slate-200 bg-white text-slate-600",
        pink: "border-pink-100 bg-pink-50 text-pink-700",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant, className }))} {...props} />;
}
