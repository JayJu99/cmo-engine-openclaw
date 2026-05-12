import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex h-10 items-center justify-center gap-2 whitespace-nowrap rounded-xl px-4 text-sm font-semibold transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4",
  {
    variants: {
      variant: {
        default:
          "bg-indigo-600 text-white shadow-[0_12px_28px_rgba(79,70,229,0.24)] hover:-translate-y-0.5 hover:bg-indigo-700",
        outline:
          "border border-slate-200 bg-white text-slate-800 shadow-sm hover:-translate-y-0.5 hover:border-indigo-200 hover:bg-indigo-50",
        ghost: "text-slate-600 hover:bg-slate-100 hover:text-slate-950",
        soft: "bg-indigo-50 text-indigo-700 hover:bg-indigo-100",
      },
      size: {
        default: "h-10 px-4",
        sm: "h-8 rounded-lg px-3 text-xs",
        lg: "h-12 rounded-2xl px-5",
        icon: "size-10 px-0",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

export function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: ButtonProps) {
  const Comp = asChild ? Slot : "button";

  return (
    <Comp
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}
