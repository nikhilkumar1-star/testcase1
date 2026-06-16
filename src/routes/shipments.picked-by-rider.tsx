import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/shipments/picked-by-rider")({
  component: () => (
    <div className="p-8">
      <h1 className="text-2xl font-semibold tracking-tight">Picked by Rider</h1>
      <p className="text-sm text-muted-foreground mt-1">Scan shipments handed over by pickup riders. (Module placeholder.)</p>
    </div>
  ),
});
