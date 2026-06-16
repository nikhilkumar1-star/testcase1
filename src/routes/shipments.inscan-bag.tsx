import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/shipments/inscan-bag")({
  component: () => (
    <div className="p-8">
      <h1 className="text-2xl font-semibold tracking-tight">Inscan · Bag</h1>
      <p className="text-sm text-muted-foreground mt-1">Initialize and scan inbound bags. (Module placeholder.)</p>
    </div>
  ),
});
