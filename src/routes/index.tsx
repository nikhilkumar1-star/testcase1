import { createFileRoute, Link } from "@tanstack/react-router";
import { ScanLine, Package, Briefcase, Truck } from "lucide-react";

export const Route = createFileRoute("/")({
  component: Dashboard,
});

const stats = [
  { label: "Shipments Today", value: "1,284", icon: Package, accent: "text-status-rescheduled bg-status-rescheduled-bg" },
  { label: "Active Scan Sessions", value: "3", icon: ScanLine, accent: "text-primary bg-accent" },
  { label: "Bags Open", value: "12", icon: Briefcase, accent: "text-status-pending bg-status-pending-bg" },
  { label: "Trips In Transit", value: "7", icon: Truck, accent: "text-status-priority bg-status-priority-bg" },
];

function Dashboard() {
  return (
    <div className="p-8">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">Operations Dashboard</h1>
        <p className="text-sm text-muted-foreground mt-1">Delhi Sorting Hub-1 · Live overview</p>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="rounded-xl border bg-card p-5">
            <div className={`grid h-10 w-10 place-items-center rounded-lg ${s.accent}`}>
              <s.icon className="h-5 w-5" />
            </div>
            <div className="mt-4 text-2xl font-semibold">{s.value}</div>
            <div className="text-sm text-muted-foreground">{s.label}</div>
          </div>
        ))}
      </div>

      <div className="mt-8 rounded-xl border bg-card p-6">
        <h2 className="text-lg font-semibold">Jump to Scan Tally</h2>
        <p className="text-sm text-muted-foreground mt-1 mb-4">
          Run a hub physical inventory scan tally for FM or LM operations.
        </p>
        <Link
          to="/scan-tally"
          className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          <ScanLine className="h-4 w-4" /> Open Scan Tally
        </Link>
      </div>
    </div>
  );
}
