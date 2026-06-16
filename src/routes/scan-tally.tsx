import { createFileRoute } from "@tanstack/react-router";
import { ScanTallyModule } from "@/components/scan-tally/ScanTallyModule";

export const Route = createFileRoute("/scan-tally")({
  head: () => ({
    meta: [
      { title: "Scan Tally · RocketXpress" },
      { name: "description", content: "Hub physical inventory scan tally — FM & LM operations with warehouse-friendly scanner UX." },
    ],
  }),
  component: ScanTallyModule,
});
