import { StudioView } from "@/components/cmo-apps/studio-view";

export const dynamic = "force-dynamic";

export default function StudioPage() {
  return <StudioView imageModeEnabled={process.env.CMO_STUDIO_IMAGE_MODE_ENABLED === "true"} />;
}
