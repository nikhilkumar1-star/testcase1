import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import {
  LayoutDashboard,
  Package,
  ScanLine,
  Briefcase,
  Truck,
  Route as RouteIcon,
  FileBarChart,
  Search,
  ChevronDown,
  Rocket,
  Check,
  Warehouse,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { HUBS, setHub, useHub, type Hub } from "@/lib/hub-store";

type NavItem = {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  children?: { to: string; label: string }[];
};

const NAV: NavItem[] = [
  { to: "/", label: "Dashboard", icon: LayoutDashboard },
  {
    to: "/shipments",
    label: "Shipments",
    icon: Package,
    children: [
      { to: "/shipments/inscan-bag", label: "Inscan · Bag" },
      { to: "/shipments/picked-by-rider", label: "Picked by Rider" },
    ],
  },
  { to: "/scan-tally", label: "Scan Tally", icon: ScanLine },
  { to: "/bags", label: "Bags", icon: Briefcase },
  { to: "/pickup-trips", label: "Pickup Trips", icon: Truck },
  { to: "/linehaul-trips", label: "Linehaul Trips", icon: RouteIcon },
  { to: "/reports", label: "Reports", icon: FileBarChart },
];

export function AppLayout() {
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({
    "/shipments": true,
  });

  return (
    <div className="flex min-h-screen bg-background text-foreground">
      <aside className="hidden w-64 shrink-0 flex-col border-r border-sidebar-border bg-sidebar md:flex">
        <div className="flex h-16 items-center gap-2 px-5 border-b border-sidebar-border">
          <div className="grid h-8 w-8 place-items-center rounded-lg bg-primary text-primary-foreground">
            <Rocket className="h-4 w-4" />
          </div>
          <div className="text-[15px] font-semibold tracking-tight">
            Rocket<span className="text-primary">Xpress</span>
          </div>
        </div>

        <nav className="flex-1 overflow-y-auto p-3 text-sm">
          {NAV.map((item) => {
            const Icon = item.icon;
            const active =
              item.to === "/"
                ? pathname === "/"
                : pathname === item.to || pathname.startsWith(item.to + "/") ||
                  (item.children?.some((c) => pathname.startsWith(c.to)) ?? false);

            if (item.children) {
              const open = openGroups[item.to] ?? active;
              return (
                <div key={item.to} className="mb-0.5">
                  <button
                    onClick={() =>
                      setOpenGroups((g) => ({ ...g, [item.to]: !open }))
                    }
                    className={cn(
                      "flex w-full items-center gap-3 rounded-md px-3 py-2 text-left font-medium transition-colors",
                      active
                        ? "bg-sidebar-accent text-sidebar-accent-foreground"
                        : "text-sidebar-foreground hover:bg-muted",
                    )}
                  >
                    <Icon className="h-4 w-4 shrink-0" />
                    <span className="flex-1 truncate">{item.label}</span>
                    <ChevronDown
                      className={cn(
                        "h-3.5 w-3.5 transition-transform",
                        open && "rotate-180",
                      )}
                    />
                  </button>
                  {open && (
                    <div className="ml-7 mt-1 flex flex-col gap-0.5 border-l border-sidebar-border pl-3">
                      {item.children.map((c) => {
                        const childActive = pathname === c.to || pathname.startsWith(c.to + "/");
                        return (
                          <Link
                            key={c.to}
                            to={c.to}
                            className={cn(
                              "rounded-md px-3 py-1.5 text-[13px] transition-colors",
                              childActive
                                ? "bg-sidebar-accent font-medium text-sidebar-accent-foreground"
                                : "text-muted-foreground hover:bg-muted hover:text-foreground",
                            )}
                          >
                            {c.label}
                          </Link>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            }

            return (
              <Link
                key={item.to}
                to={item.to}
                className={cn(
                  "mb-0.5 flex items-center gap-3 rounded-md px-3 py-2 font-medium transition-colors",
                  active
                    ? "bg-sidebar-accent text-sidebar-accent-foreground"
                    : "text-sidebar-foreground hover:bg-muted",
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className="truncate">{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="border-t border-sidebar-border p-3 text-xs text-muted-foreground">
          <div className="flex items-center gap-2">
            <div className="grid h-8 w-8 place-items-center rounded-full bg-primary/15 text-primary font-semibold">
              TU
            </div>
            <div className="min-w-0">
              <div className="truncate text-foreground font-medium">Test User</div>
              <HubLabel />
            </div>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 flex h-16 items-center gap-4 border-b bg-background/80 px-6 backdrop-blur">
          {!pathname.startsWith("/scan-tally") && (
            <div className="relative flex-1 max-w-xl">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                placeholder="Scan AWB or Search…"
                className="h-10 w-full rounded-md border bg-card pl-9 pr-16 text-sm outline-none focus:ring-2 focus:ring-ring/40"
              />
              <kbd className="absolute right-2 top-1/2 -translate-y-1/2 rounded border bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">
                ⌘K
              </kbd>
            </div>
          )}
          <div className="flex-1" />
          <HubPicker />
        </header>

        <main className="flex-1 min-w-0">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

function HubLabel() {
  const hub = useHub();
  return <div className="truncate">{hub.name}</div>;
}

function HubPicker() {
  const hub = useHub();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 rounded-full border bg-card px-3 py-1.5 text-sm font-medium"
      >
        <span className="h-2 w-2 rounded-full bg-status-fresh" />
        {hub.name}
        <ChevronDown className="h-3.5 w-3.5" />
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-2 w-72 rounded-lg border bg-popover p-1.5 shadow-lg">
          <div className="px-2 pt-1.5 pb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Select Hub
          </div>
          {HUBS.map((h) => {
            const isActive = h.id === hub.id;
            return (
              <button
                key={h.id}
                onClick={() => {
                  setHub(h);
                  setOpen(false);
                }}
                className={cn(
                  "flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left text-sm hover:bg-muted",
                  isActive && "bg-muted",
                )}
              >
                <Warehouse className="h-4 w-4 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{h.name}</div>
                  <div className="text-[11px] text-muted-foreground">{kindLabel(h)}</div>
                </div>
                {isActive && <Check className="h-4 w-4 text-primary" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function kindLabel(h: Hub) {
  switch (h.kind) {
    case "Sorting": return "Sorting Hub";
    case "LM": return "LM Warehouse · Last Mile operations";
    case "FM": return "FM Warehouse · First Mile operations";
  }
}
