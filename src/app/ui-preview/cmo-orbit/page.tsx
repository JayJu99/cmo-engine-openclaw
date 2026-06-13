import type { Metadata } from "next";

import { CmoOrbitPreview } from "@/components/ui-preview/cmo-orbit-preview";

export const metadata: Metadata = {
  title: "CMO Orbit UI Preview",
  description: "Isolated preview route for the experimental CMO Orbit hero UI.",
  robots: {
    index: false,
    follow: false,
  },
};

export default function CmoOrbitPreviewPage() {
  return <CmoOrbitPreview />;
}
