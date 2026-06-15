"use client";

import Image from "next/image";

import { icons } from "@/components/dashboard/icons";
import { cn } from "@/lib/utils";

type ProjectLogoApp = {
  id?: string;
  name: string;
  slug?: string;
};

type ProjectLogo = {
  height: number;
  shape?: "square" | "wide";
  src: string;
  width: number;
};

const projectLogos: Record<string, ProjectLogo> = {
  aion: {
    src: "/app-logos/aion.png",
    width: 180,
    height: 180,
    shape: "square",
  },
  "eggs-vault": {
    src: "/app-logos/eggs-vault.png",
    width: 180,
    height: 180,
    shape: "square",
  },
  feedback: {
    src: "/app-logos/feedback.png",
    width: 180,
    height: 180,
    shape: "square",
  },
  "hold-pay": {
    src: "/app-logos/hold-pay.png",
    width: 190,
    height: 96,
    shape: "wide",
  },
  "holdstation-mini-app": {
    src: "/app-logos/holdstation-mini-app.png",
    width: 1500,
    height: 1500,
    shape: "square",
  },
  "holdstation-wallet": {
    src: "/app-logos/holdstation-wallet.png",
    width: 160,
    height: 160,
    shape: "square",
  },
  winance: {
    src: "/app-logos/winance.png",
    width: 180,
    height: 180,
    shape: "square",
  },
};

export function AppProjectLogo({
  app,
  className,
  iconClassName,
}: {
  app: ProjectLogoApp;
  className?: string;
  iconClassName?: string;
}) {
  const logo = projectLogos[app.slug ?? ""] ?? projectLogos[app.id ?? ""];
  const isSquareLogo = logo?.shape === "square";

  if (logo) {
    return (
      <div
        className={cn(
          isSquareLogo
            ? "flex size-12 items-center justify-center overflow-hidden rounded-2xl"
            : "flex h-12 w-28 items-center justify-start",
          className,
        )}
      >
        <Image
          alt={`${app.name} logo`}
          className={cn(
            "object-contain",
            isSquareLogo ? "size-full" : "h-auto max-h-8 w-auto max-w-full",
          )}
          height={logo.height}
          priority={false}
          src={logo.src}
          width={logo.width}
        />
      </div>
    );
  }

  return (
    <div className={cn("grid size-12 place-items-center rounded-2xl bg-indigo-50 text-indigo-700 ring-1 ring-indigo-100", className)}>
      <icons.Package className={iconClassName} />
    </div>
  );
}
