import type { Metadata } from "next";

import { MascotMotionPreview } from "@/components/ui-preview/mascot-motion-preview";

export const metadata: Metadata = {
  title: "Mascot Motion Preview",
  description: "WebM preview for the CMO Engine mascot animation asset.",
  robots: {
    index: false,
    follow: false,
  },
};

export default function MascotPreviewPage() {
  return <MascotMotionPreview />;
}
