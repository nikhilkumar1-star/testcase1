import { useEffect, useMemo, useRef, useState } from "react";
import {
  ScanLine,
  CheckCircle2,
  AlertTriangle,
  Download,
  FileSpreadsheet,
  History as HistoryIcon,
  Sparkles,
  Star,
  PackageX,
  X,
  ArrowRight,
  RefreshCcw,
  AlertOctagon,
  TriangleAlert,
  Target,
  Barcode,
  CircleAlert,
  ClipboardList,
  TrendingUp,
  ListChecks,
  RotateCcw,
  CalendarDays,
  CalendarClock,
  PackageCheck,
  ScanSearch,
  PackageSearch,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useHub } from "@/lib/hub-store";

// ---------------------------------------------------------------------------
// Shared types
// ---------------------------------------------------------------------------

type StatusKey = "Fresh" | "Pending Attempt" | "Undelivered" | "Cancelled" | "RTO" | "Priority" | "Rescheduled" | "Missroute";
type LMFilterCard = "Fresh" | "UD" | "Refusal" | "RTO" | "Excess" | "Missing" | "Priority";
type FMFilterCard = "Rescheduled" | "Priority";
type FilterCard = LMFilterCard | FMFilterCard;

type ExpectedShipment = { awb: string; status: StatusKey; reason: string; daysInHub: number; attempts: number; isPriority: boolean };

// ---------------------------------------------------------------------------
// LM Inventory data
// ---------------------------------------------------------------------------

// Priority is a cross-cutting tag — any status can also be marked Priority.
// Tag rules: every 20th Fresh, every 12th Pending/Undelivered, every 7th Cancelled, every 10th RTO.
const LM_STATUS_RECIPE: { status: StatusKey; reasons: string[]; count: number; att: (i: number) => number; pri: (i: number) => boolean }[] = [
  { status: "Fresh",           count: 245, att: ()  => 0,           pri: (i) => i % 20 === 0,  reasons: ["Reached at Destination", "Awaiting First Delivery Attempt"] },
  { status: "Pending Attempt", count: 180, att: ()  => 1,           pri: (i) => i % 12 === 0,  reasons: ["Customer Not Available", "Wrong Address", "Delivery Rescheduled", "Cash Not Ready", "Entry Restricted"] },
  { status: "Undelivered",     count: 120, att: (i) => (i % 3) + 2, pri: (i) => i % 12 === 6,  reasons: ["Customer Not Available", "Wrong Address", "Delivery Rescheduled", "Cash Not Ready", "Entry Restricted"] },
  { status: "Cancelled",       count:  18, att: (i) => (i % 2) + 1, pri: (i) => i % 7 === 0,   reasons: ["Cancelled by Customer (Code Verified)"] },
  // Code Not Verified → treated as Undelivered for re-delivery; shown with reason "Refusal – Code Not Verified"
  { status: "Undelivered",     count:  17, att: (i) => (i % 2) + 1, pri: ()  => false,            reasons: ["Refusal – Code Not Verified"] },
  { status: "RTO",             count:  42, att: (i) => (i % 2) + 2, pri: (i) => i % 10 === 0,  reasons: ["RTO In Transit"] },
  { status: "Missroute",       count:   9, att: ()  => 0,           pri: ()  => false,           reasons: ["Correct Hub: Faridabad LM", "Correct Hub: Noida FM"] },
];

const LM_EXPECTED_INVENTORY: ExpectedShipment[] = (() => {
  const list: ExpectedShipment[] = [];
  let n = 1100000;
  for (const r of LM_STATUS_RECIPE) {
    for (let i = 0; i < r.count; i++) {
      n += 7 + (i % 3);
      const isFresh = r.status === "Fresh";
      list.push({
        awb: `RX${n}`,
        status: r.status,
        reason: r.reasons[i % r.reasons.length],
        daysInHub: isFresh ? 0 : (i % 5) + 1,
        attempts: r.att(i),
        isPriority: r.pri(i),
      });
    }
  }
  return list;
})();

// Fixed AWBs that are always in the expected manifest (used for live demos / training).
// RX110013 & RX110014 are intentionally absent — scanning them triggers an Excess alert.
// RX110011 & RX110012 are in the manifest but never scanned — they surface as Missing.
const LM_DEMO_SEEDS: ExpectedShipment[] = [
  { awb: "RX110001", status: "Fresh",           reason: "Reached at Destination",                      daysInHub: 0, attempts: 0, isPriority: false },
  { awb: "RX110002", status: "Fresh",           reason: "Awaiting First Delivery Attempt",              daysInHub: 1, attempts: 0, isPriority: false },
  { awb: "RX110003", status: "Pending Attempt", reason: "Customer Not Available",                       daysInHub: 3, attempts: 1, isPriority: true  },
  { awb: "RX110004", status: "Undelivered",     reason: "Wrong Address",                               daysInHub: 4, attempts: 2, isPriority: true  },
  { awb: "RX110005", status: "Pending Attempt", reason: "Customer Not Available",                       daysInHub: 1, attempts: 1, isPriority: false },
  { awb: "RX110006", status: "Undelivered",     reason: "Delivery Rescheduled",                        daysInHub: 2, attempts: 2, isPriority: false },
  { awb: "RX110007", status: "Cancelled",       reason: "Cancelled by Customer (Code Verified)",        daysInHub: 1, attempts: 1, isPriority: false },
  { awb: "RX110008", status: "Undelivered",     reason: "Refusal – Code Not Verified",                 daysInHub: 2, attempts: 1, isPriority: false },
  { awb: "RX110009", status: "RTO",             reason: "RTO In Transit",                              daysInHub: 4, attempts: 3, isPriority: false },
  { awb: "RX110010", status: "RTO",             reason: "RTO In Transit",                              daysInHub: 3, attempts: 2, isPriority: false },
  { awb: "RX110011", status: "Fresh",           reason: "Not Found During Hub Scan",                   daysInHub: 3, attempts: 0, isPriority: false },
  { awb: "RX110012", status: "Fresh",           reason: "Not Found During Hub Scan",                   daysInHub: 5, attempts: 0, isPriority: false },
];

// Merge seeds into the full inventory; seeds override any generated entry with the same AWB.
const LM_ALL_INVENTORY: ExpectedShipment[] = [
  ...LM_EXPECTED_INVENTORY.filter((s) => !LM_DEMO_SEEDS.some((d) => d.awb === s.awb)),
  ...LM_DEMO_SEEDS,
];

const LM_EXPECTED_INDEX = new Map(LM_ALL_INVENTORY.map((s) => [s.awb, s]));
const LM_TOTAL_EXPECTED = LM_ALL_INVENTORY.length;

// Extra demo AWBs — not shown in UI, available for manual scan testing
const LM_SCAN_SAMPLES = {
  Fresh:    LM_EXPECTED_INVENTORY.filter((s) => s.status === "Fresh" && !s.isPriority).slice(0, 4).map((s) => s.awb),
  UD:       LM_EXPECTED_INVENTORY.filter((s) => (s.status === "Undelivered" || s.status === "Pending Attempt") && !s.isPriority).slice(0, 4).map((s) => s.awb),
  Refusal:  LM_EXPECTED_INVENTORY.filter((s) => s.status === "Cancelled" && !s.isPriority).slice(0, 4).map((s) => s.awb),
  RTO:      LM_EXPECTED_INVENTORY.filter((s) => s.status === "RTO" && !s.isPriority).slice(0, 4).map((s) => s.awb),
  Priority: LM_EXPECTED_INVENTORY.filter((s) => s.isPriority).slice(0, 4).map((s) => s.awb),
  Excess:   ["RX110013", "RX110014"],
};
void LM_SCAN_SAMPLES; // suppress unused warning — samples available for console testing

// ---------------------------------------------------------------------------
// FM Inventory data
// ---------------------------------------------------------------------------

const FM_STATUS_RECIPE: { status: StatusKey; reasons: string[]; count: number; att: (i: number) => number }[] = [
  { status: "Rescheduled", count: 89,  att: () => 1, reasons: ["Seller requested later date", "Pickup slot unavailable", "Seller on holiday", "Address correction pending"] },
  { status: "Priority",    count: 34,  att: () => 1, reasons: ["High-value shipment", "VIP seller", "SLA breach risk", "Escalated pickup request"] },
  { status: "Fresh",       count: 312, att: () => 0, reasons: ["Awaiting pickup", "Newly inducted"] },
];

const FM_EXPECTED_INVENTORY: ExpectedShipment[] = (() => {
  const list: ExpectedShipment[] = [];
  let n = 2200000;
  for (const r of FM_STATUS_RECIPE) {
    for (let i = 0; i < r.count; i++) {
      n += 11 + (i % 5);
      list.push({ awb: `RX${n}`, status: r.status, reason: r.reasons[i % r.reasons.length], daysInHub: (i % 4) + 1, attempts: r.att(i), isPriority: r.status === "Priority" });
    }
  }
  return list;
})();

const FM_EXPECTED_INDEX = new Map(FM_EXPECTED_INVENTORY.map((s) => [s.awb, s]));
const FM_TOTAL_EXPECTED = FM_EXPECTED_INVENTORY.length;

const FM_DEMO_AWBS = {
  Rescheduled: FM_EXPECTED_INVENTORY.filter((s) => s.status === "Rescheduled").slice(0, 2).map((s) => s.awb),
  Priority:    FM_EXPECTED_INVENTORY.filter((s) => s.status === "Priority").slice(0, 2).map((s) => s.awb),
  Excess:      ["RX9991001", "RX9991002"],
};

// ---------------------------------------------------------------------------
// Session types
// ---------------------------------------------------------------------------

type SessionStatus = "Active" | "Completed" | "Reopened";

type Session = {
  id: string;
  status: SessionStatus;
  scanned: number;
  missing: number;
  expected: number;
  excess: number;
  accuracy: number;
};

const INITIAL_SESSIONS: Session[] = [
  { id: "TLY-20260610-001", status: "Completed", scanned: 187, missing:  0, expected: 649, excess: 0, accuracy: 100 },
  { id: "TLY-20260609-001", status: "Completed", scanned: 204, missing: 11, expected: 649, excess: 2, accuracy:  94 },
  { id: "TLY-20260608-001", status: "Completed", scanned: 162, missing:  2, expected: 649, excess: 0, accuracy:  98 },
];

// ---------------------------------------------------------------------------
// Color helpers
// ---------------------------------------------------------------------------

const LM_CARD_COLORS: Record<LMFilterCard, { bg: string; border: string; text: string; count: string }> = {
  Priority: { bg: "bg-red-50",     border: "border-red-400",     text: "text-red-700",     count: "text-red-900"     },
  Fresh:    { bg: "bg-emerald-50", border: "border-emerald-200", text: "text-emerald-700", count: "text-emerald-900" },
  UD:       { bg: "bg-amber-50",   border: "border-amber-200",   text: "text-amber-700",   count: "text-amber-900"   },
  Refusal:  { bg: "bg-red-50",     border: "border-red-200",     text: "text-red-700",     count: "text-red-900"     },
  RTO:      { bg: "bg-purple-50",  border: "border-purple-200",  text: "text-purple-700",  count: "text-purple-900"  },
  Missing:  { bg: "bg-rose-50",    border: "border-rose-300",    text: "text-rose-700",    count: "text-rose-900"    },
  Excess:   { bg: "bg-orange-50",  border: "border-orange-200",  text: "text-orange-700",  count: "text-orange-900"  },
};

const FM_CARD_COLORS: Record<FMFilterCard, { bg: string; border: string; text: string; count: string }> = {
  Rescheduled: { bg: "bg-sky-50",  border: "border-sky-200",  text: "text-sky-700",  count: "text-sky-900"  },
  Priority:    { bg: "bg-pink-50", border: "border-pink-200", text: "text-pink-700", count: "text-pink-900" },
};

const STATUS_BADGE: Record<StatusKey | "Excess", { bg: string; text: string }> = {
  Fresh:            { bg: "bg-emerald-100", text: "text-emerald-800" },
  "Pending Attempt":{ bg: "bg-amber-100",   text: "text-amber-800"   },
  Undelivered:      { bg: "bg-amber-100",   text: "text-amber-800"   },
  Cancelled:        { bg: "bg-red-100",     text: "text-red-800"     },
  RTO:              { bg: "bg-purple-100",  text: "text-purple-800"  },
  Priority:         { bg: "bg-pink-100",    text: "text-pink-800"    },
  Rescheduled:      { bg: "bg-sky-100",     text: "text-sky-800"     },
  Missroute:        { bg: "bg-orange-100",  text: "text-orange-800"  },
  Excess:           { bg: "bg-orange-100",  text: "text-orange-800"  },
};

const STATUS_ICON: Record<StatusKey | "Excess", React.ComponentType<{ className?: string }>> = {
  Fresh:            Sparkles,
  "Pending Attempt":AlertTriangle,
  Undelivered:      RefreshCcw,
  Cancelled:        X,
  RTO:              AlertOctagon,
  Priority:         Star,
  Rescheduled:      CalendarClock,
  Missroute:        TriangleAlert,
  Excess:           TriangleAlert,
};

const SESSION_STATUS_BADGE: Record<SessionStatus, { bg: string; text: string; dot: string; label: string }> = {
  Active:    { bg: "bg-purple-100", text: "text-purple-800", dot: "bg-purple-500",  label: "Active"    },
  Completed: { bg: "bg-emerald-100",text: "text-emerald-800",dot: "bg-emerald-500", label: "Completed" },
  Reopened:  { bg: "bg-amber-100",  text: "text-amber-800",  dot: "bg-amber-500",   label: "Reopened"  },
};

function nowTimeString() {
  return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: true });
}

function todayLabel() {
  return new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function lastAttemptDate(daysInHub: number) {
  const d = new Date();
  d.setDate(d.getDate() - (daysInHub - 1));
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

// ---------------------------------------------------------------------------
// Scan warning logic
// ---------------------------------------------------------------------------

type ScanWarning = { message: string; kind: "priority" | "aging" } | null;

function getDisplayStatus(status: StatusKey | "Excess", isPriority: boolean): string {
  if (isPriority) return "Priority";
  if (status === "Pending Attempt" || status === "Undelivered") return "Undelivered";
  if (status === "RTO") return "RTO Initiated";
  if (status === "Cancelled") return "Refusal";
  return status;
}

function getScanWarning(s: ExpectedShipment): ScanWarning {
  if (s.isPriority) {
    return { kind: "priority", message: `Priority shipment (${getDisplayStatus(s.status, false)}) — act immediately` };
  }
  if (s.status === "Fresh" && s.daysInHub > 2) {
    return { kind: "aging", message: `Aging: ${s.daysInHub} days in hub, no delivery attempt yet` };
  }
  const isUD = s.status === "Undelivered" || s.status === "Pending Attempt";
  if (isUD && s.attempts < 3 && s.daysInHub > 2) {
    return { kind: "aging", message: `At-risk: ${s.daysInHub} days idle, only ${s.attempts} attempt${s.attempts === 1 ? "" : "s"} — needs action` };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ScanRecord = { awb: string; status: StatusKey | "Excess"; reason: string; daysInHub: number; attempts: number; isPriority: boolean; scannedAt: string };
type ScanError  = { awb: string; message: string; at: number } | null;

type TableRow = { awb: string; status: StatusKey | "Excess"; reason: string; daysInHub: number; attempts: number; isPriority: boolean; scannedAt?: string };

// ---------------------------------------------------------------------------
// Main module
// ---------------------------------------------------------------------------

export function ScanTallyModule() {
  const hub = useHub();
  const isFM = hub.kind === "FM";

  const [tab, setTab]                       = useState<"scan" | "history">("scan");
  const [scans, setScans]                   = useState<ScanRecord[]>([]);
  const [completeOpen, setCompleteOpen]     = useState(false);
  const [isCompleted, setIsCompleted]       = useState(false);
  const [sessionHistory, setSessionHistory] = useState<Session[]>(INITIAL_SESSIONS);
  const [viewSummary, setViewSummary]       = useState<Session | null>(null);
  const [input, setInput]                   = useState("");
  const [error, setError]                   = useState<ScanError>(null);
  const [scanWarning, setScanWarning]       = useState<ScanWarning>(null);
  const [filter, setFilter]                 = useState<FilterCard | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setScans([]); setFilter(null); setIsCompleted(false);
    setCompleteOpen(false); setTab("scan"); setScanWarning(null);
  }, [hub.id]);

  useEffect(() => { if (tab === "scan") inputRef.current?.focus(); }, [tab]);

  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(null), 4000);
    return () => clearTimeout(t);
  }, [error]);

  useEffect(() => {
    if (!scanWarning) return;
    const t = setTimeout(() => setScanWarning(null), 5000);
    return () => clearTimeout(t);
  }, [scanWarning]);

  const expectedIndex = isFM ? FM_EXPECTED_INDEX : LM_EXPECTED_INDEX;
  const totalExpected = isFM ? FM_TOTAL_EXPECTED : LM_TOTAL_EXPECTED;

  const scannedSet   = useMemo(() => new Set(scans.map((s) => s.awb)), [scans]);
  const scannedCount = scans.length;
  const excessCount  = useMemo(() => scans.filter((s) => s.status === "Excess").length, [scans]);
  const missing      = Math.max(0, totalExpected - (scannedCount - excessCount));
  const accuracy     = totalExpected > 0 ? Math.round(((scannedCount - excessCount) / totalExpected) * 100) : 0;
  const latest       = scans[0];
  const sessionId    = "TLY-20260611-001";

  // Live AWB lookup — resolves as user types; null when no full match
  const liveMatch = useMemo(() => {
    const awb = input.trim().toUpperCase();
    if (awb.length < 5) return null;
    return expectedIndex.get(awb) ?? null;
  }, [input, expectedIndex]);

  function pushScan(raw: string) {
    const awb = raw.trim().toUpperCase();
    if (!awb) return;
    if (scannedSet.has(awb)) {
      setError({ awb, message: `${awb} already scanned in this session`, at: Date.now() });
      setInput(""); inputRef.current?.focus(); return;
    }
    const expected = expectedIndex.get(awb);
    if (!expected) {
      if (/^RX\d{4,}$/i.test(awb)) {
        setScans((prev) => [{ awb, status: "Excess", reason: "Extra Shipment Found at Hub", daysInHub: 0, attempts: 0, isPriority: false, scannedAt: nowTimeString() }, ...prev]);
        setError({ awb, message: `Excess — ${awb}: Shipment scanned but not part of today's expected tally`, at: Date.now() });
      } else {
        setError({ awb, message: "Invalid AWB format", at: Date.now() });
      }
      setInput(""); inputRef.current?.focus(); return;
    }
    setScans((prev) => [{ awb: expected.awb, status: expected.status, reason: expected.reason, daysInHub: expected.daysInHub, attempts: expected.attempts, isPriority: expected.isPriority, scannedAt: nowTimeString() }, ...prev]);
    setError(null);
    setScanWarning(getScanWarning(expected));
    setInput(""); inputRef.current?.focus();
  }

  function completeSession() {
    const session: Session = { id: sessionId, status: "Completed", scanned: scannedCount, missing, expected: totalExpected, excess: excessCount, accuracy };
    setIsCompleted(true);
    setSessionHistory((prev) => [session, ...prev.filter((s) => s.id !== sessionId)]);
    setCompleteOpen(false);
    setTab("history");
  }

  function reopenSession(id: string) {
    if (id === sessionId) {
      setIsCompleted(false);
      setSessionHistory((prev) => prev.filter((s) => s.id !== id));
      setTab("scan");
    } else {
      setSessionHistory((prev) => prev.map((s) => s.id === id ? { ...s, status: "Reopened" as SessionStatus } : s));
    }
  }

  function downloadInterimExcel() {
    const rows = [["Session ID", sessionId], ["Hub", hub.name], ["Date", todayLabel()], [], ["Metric", "Value"], ["Expected", totalExpected], ["Scanned", scannedCount], ["Missing", missing], ["Excess", excessCount], ["Accuracy", `${accuracy}%`]];
    triggerDownload(rows.map((r) => r.join(",")).join("\n"), `${sessionId}-interim.csv`);
  }

  function downloadSessionCsv(s: Session) {
    const rows = [["Session ID", s.id], [], ["Metric", "Value"], ["Expected", s.expected], ["Scanned", s.scanned], ["Missing", s.missing], ["Excess", s.excess], ["Accuracy", `${s.accuracy}%`]];
    triggerDownload(rows.map((r) => r.join(",")).join("\n"), `${s.id}.csv`);
  }

  const allScannedRows = useMemo((): TableRow[] => scans.map((s) => ({
    awb: s.awb, status: s.status, reason: s.reason, daysInHub: s.daysInHub, attempts: s.attempts, isPriority: s.isPriority, scannedAt: s.scannedAt,
  })), [scans]);

  // Unscanned expected shipments — used by the Missing filter
  const missingRows = useMemo((): TableRow[] =>
    LM_ALL_INVENTORY
      .filter((s) => !scannedSet.has(s.awb))
      .map((s) => ({ awb: s.awb, status: s.status, reason: s.reason, daysInHub: s.daysInHub, attempts: s.attempts, isPriority: s.isPriority })),
  [scannedSet]);

  const tableRows = useMemo((): TableRow[] => {
    if (!isFM && filter === "Missing")   return missingRows;
    if (!isFM && filter === "Priority")  return allScannedRows.filter((r) => r.isPriority);
    if (!filter)                         return allScannedRows;
    if (filter === "Fresh")              return allScannedRows.filter((r) => r.status === "Fresh");
    if (filter === "UD")                 return allScannedRows.filter((r) => r.status === "Undelivered" || r.status === "Pending Attempt");
    if (filter === "Refusal")            return allScannedRows.filter((r) => r.status === "Cancelled");
    if (filter === "RTO")                return allScannedRows.filter((r) => r.status === "RTO");
    if (filter === "Rescheduled")        return allScannedRows.filter((r) => r.status === "Rescheduled");
    if (filter === "Priority")           return allScannedRows.filter((r) => r.isPriority);
    if (filter === "Excess")             return allScannedRows.filter((r) => r.status === "Excess");
    return allScannedRows;
  }, [filter, allScannedRows, missingRows, isFM]);

  const lmCardCounts = useMemo(() => {
    const c: Record<LMFilterCard, number> = { Priority: 0, Fresh: 0, UD: 0, Refusal: 0, RTO: 0, Missing: 0, Excess: 0 };
    for (const s of scans) {
      if (s.isPriority)                                                        c.Priority++;
      if (s.status === "Fresh")                                                c.Fresh++;
      else if (s.status === "Undelivered" || s.status === "Pending Attempt")  c.UD++;
      else if (s.status === "Cancelled")                                       c.Refusal++;
      else if (s.status === "RTO")                                             c.RTO++;
      else if (s.status === "Excess")                                          c.Excess++;
    }
    const validScanned = scans.filter((s) => s.status !== "Excess").length;
    c.Missing = Math.max(0, LM_TOTAL_EXPECTED - validScanned);
    return c;
  }, [scans]);

  const fmCardCounts = useMemo(() => {
    const c: Record<FMFilterCard, number> = { Rescheduled: 0, Priority: 0 };
    for (const s of scans) {
      if (s.status === "Rescheduled")      c.Rescheduled++;
      else if (s.status === "Priority")    c.Priority++;
    }
    return c;
  }, [scans]);

  // Missing items list for complete modal
  const missingItemsList = useMemo(() =>
    LM_ALL_INVENTORY.filter((s) => !scannedSet.has(s.awb)),
  [scannedSet]);

  return (
    <div className="flex flex-col pb-24">

      {/* ── HEADER ── */}
      <div className="border-b bg-card px-6 py-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-lg font-bold leading-tight">Scan Tally Session</h1>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <span className="font-mono text-xs font-semibold text-foreground">{sessionId}</span>
              <span>·</span><span>{hub.name}</span>
              <span>·</span>
              <span className="flex items-center gap-1"><CalendarDays className="h-3.5 w-3.5" />{todayLabel()}</span>
              <span>·</span>
              <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-bold", isCompleted ? "bg-emerald-100 text-emerald-800" : "bg-purple-100 text-purple-800")}>
                <span className={cn("inline-block h-1.5 w-1.5 rounded-full", isCompleted ? "bg-emerald-500" : "bg-purple-500 animate-pulse")} />
                {isCompleted ? "Completed" : "Active Session"}
              </span>
            </div>
          </div>

          <div className="flex rounded-xl border-2 border-border bg-muted/60 p-1 gap-1">
            {([
              { k: "scan"    as const, l: "Scan Session",    I: Target      },
              { k: "history" as const, l: "Session History", I: HistoryIcon },
            ]).map((t) => (
              <button key={t.k} onClick={() => setTab(t.k)}
                className={cn("inline-flex items-center gap-2 rounded-lg px-5 py-2 text-sm font-bold transition-all",
                  tab === t.k ? "bg-background text-foreground shadow-sm ring-1 ring-border" : "text-muted-foreground hover:text-foreground")}>
                <t.I className="h-4 w-4" /> {t.l}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── SCAN TAB ── */}
      {tab === "scan" && (
        <div className="flex flex-col gap-5 p-5">

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">

            {/* Scanner card */}
            <div className="lg:col-span-4">
              <div className="rounded-xl border-2 border-primary/20 bg-card p-5 shadow-sm h-full flex flex-col">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-primary">
                    <Barcode className="h-4 w-4" /> AWB Scanner
                  </div>
                  <div className="flex items-center gap-1.5 rounded-full bg-emerald-50 border border-emerald-200 px-2.5 py-1 text-xs font-bold text-emerald-700">
                    <span className="inline-block h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                    Ready
                  </div>
                </div>

                <div className="relative">
                  <ScanLine className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 h-8 w-8 text-primary/40" />
                  <input
                    ref={inputRef}
                    value={input}
                    autoFocus
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") pushScan(input); }}
                    placeholder="Scan or Enter AWB"
                    className="h-[90px] w-full rounded-xl border-2 border-primary/30 bg-background pl-16 pr-4 text-[28px] font-mono font-black tracking-widest placeholder:text-base placeholder:font-normal placeholder:tracking-normal placeholder:text-muted-foreground/40 outline-none focus:border-primary focus:ring-4 focus:ring-primary/15 transition-all"
                  />
                </div>

                {/* Live AWB lookup preview — shows status as user types */}
                {liveMatch && !error && (
                  <div className={cn(
                    "mt-3 flex items-center gap-2.5 rounded-lg border px-3.5 py-2.5",
                    STATUS_BADGE[liveMatch.status]?.bg ?? "bg-muted",
                    "border-current/10"
                  )}>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className={cn(
                        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-black",
                        liveMatch.isPriority ? "bg-red-600 text-white" : cn(STATUS_BADGE[liveMatch.status]?.bg, STATUS_BADGE[liveMatch.status]?.text),
                      )}>
                        {liveMatch.isPriority
                          ? <Zap className="h-3 w-3 animate-pulse" />
                          : (() => { const Icon = STATUS_ICON[liveMatch.status]; return <Icon className="h-3 w-3" />; })()
                        }
                        {getDisplayStatus(liveMatch.status, liveMatch.isPriority)}
                      </span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-bold text-foreground truncate">{liveMatch.reason}</div>
                      {(liveMatch.daysInHub > 0 || liveMatch.attempts > 0) && (
                        <div className="text-[10px] text-muted-foreground">
                          {liveMatch.daysInHub > 0 && `${liveMatch.daysInHub} day${liveMatch.daysInHub !== 1 ? "s" : ""} in hub`}
                          {liveMatch.daysInHub > 0 && liveMatch.attempts > 0 && " · "}
                          {liveMatch.attempts > 0 && `${liveMatch.attempts} attempt${liveMatch.attempts !== 1 ? "s" : ""}`}
                        </div>
                      )}
                    </div>
                    <div className="shrink-0 text-[10px] font-semibold text-muted-foreground opacity-60">Press ↵ Enter</div>
                  </div>
                )}

                {/* Error alert — duplicate / excess / invalid */}
                {error && (
                  <div className="mt-3 flex items-start gap-2.5 rounded-lg border border-red-200 bg-red-50 px-3.5 py-3 text-sm">
                    <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
                    <div className="text-red-800 font-bold">{error.message}</div>
                  </div>
                )}

                {/* Scan alert — aging / priority */}
                {scanWarning && (
                  <div className={cn(
                    "mt-3 flex items-start gap-2.5 rounded-lg border px-3.5 py-3 text-sm",
                    scanWarning.kind === "priority"
                      ? "border-pink-200 bg-pink-50 text-pink-800"
                      : "border-amber-200 bg-amber-50 text-amber-800",
                  )}>
                    {scanWarning.kind === "priority"
                      ? <Zap className="mt-0.5 h-4 w-4 shrink-0 text-pink-600" />
                      : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />}
                    <div className="font-bold">{scanWarning.message}</div>
                  </div>
                )}

                {/* FM demo buttons only */}
                {isFM && (
                  <div className="mt-auto pt-5">
                    <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground mb-2">Demo · click to scan</div>
                    <div className="flex flex-col gap-2">
                      {([
                        { key: "Rescheduled" as const, label: "Rescheduled", cls: "border-sky-200  bg-sky-50  text-sky-800"  },
                        { key: "Priority"    as const, label: "Priority",    cls: "border-pink-200 bg-pink-50 text-pink-800" },
                        { key: "Excess"      as const, label: "Excess",      cls: "border-orange-200 bg-orange-50 text-orange-800" },
                      ] as { key: keyof typeof FM_DEMO_AWBS; label: string; cls: string }[]).map(({ key, label, cls }) => (
                        <div key={key} className="flex items-center gap-1.5">
                          <span className="w-20 shrink-0 text-[10px] font-black uppercase tracking-wider text-muted-foreground">{label}</span>
                          <div className="flex gap-1.5">
                            {FM_DEMO_AWBS[key].map((a) => (
                              <button key={a} onClick={() => pushScan(a)}
                                className={`rounded-md border px-2 py-1 font-mono text-[11px] font-semibold hover:opacity-75 transition-opacity ${cls}`}>
                                {a}
                              </button>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Latest scanned */}
            <div className="lg:col-span-8">
              <LatestScanCard latest={latest} />
            </div>
          </div>

          {/* ── Breakdown cards ── */}
          {isFM ? (
            <FMBreakdownSection
              scannedCount={scannedCount}
              totalExpected={totalExpected}
              missing={missing}
              excessCount={excessCount}
              fmCardCounts={fmCardCounts}
              filter={filter}
              setFilter={setFilter}
            />
          ) : (
            <LMBreakdownSection
              totalExpected={totalExpected}
              lmCardCounts={lmCardCounts}
              filter={filter}
              setFilter={setFilter}
            />
          )}

          {/* Shipment table */}
          <ShipmentTable
            rows={tableRows}
            filter={filter}
            isMissingView={!isFM && filter === "Missing"}
            onClearFilter={() => setFilter(null)}
          />
        </div>
      )}

      {/* ── HISTORY TAB ── */}
      {tab === "history" && (
        <HistoryView
          isSessionActive={!isCompleted}
          activeSessionId={sessionId}
          scannedCount={scannedCount}
          missingCount={missing}
          sessionHistory={sessionHistory}
          onContinue={() => setTab("scan")}
          onViewSummary={setViewSummary}
          onReopen={reopenSession}
          onDownloadCsv={downloadSessionCsv}
        />
      )}

      {/* Complete button bar */}
      {tab === "scan" && (
        <div className="fixed bottom-0 left-0 right-0 md:left-64 z-20 border-t bg-card/95 backdrop-blur px-6 py-3 shadow-[0_-4px_24px_rgba(0,0,0,0.08)]">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
              <BottomMetric label="Expected" value={totalExpected} />
              <BottomMetric label="Scanned"  value={scannedCount}  color="text-teal-700" />
              <BottomMetric label="Missing"  value={missing}       color={missing > 0 ? "text-red-700" : undefined} />
            </div>
            <button
              onClick={() => setCompleteOpen(true)}
              disabled={scannedCount === 0 && excessCount === 0}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-bold text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed shadow-md"
            >
              Complete Scan Tally <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}

      {completeOpen && (
        <CompleteModal
          expected={totalExpected}
          scanned={scannedCount}
          missing={missing}
          excess={excessCount}
          accuracy={accuracy}
          missingItems={isFM ? [] : missingItemsList}
          onCancel={() => setCompleteOpen(false)}
          onContinueScanning={() => setCompleteOpen(false)}
          onComplete={completeSession}
          onDownloadInterim={downloadInterimExcel}
        />
      )}

      {viewSummary && (
        <SummaryPopup session={viewSummary} onClose={() => setViewSummary(null)} onDownload={downloadSessionCsv} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// LM Breakdown Section
// ---------------------------------------------------------------------------

function LMBreakdownSection({ totalExpected, lmCardCounts, filter, setFilter }: {
  totalExpected: number;
  lmCardCounts: Record<LMFilterCard, number>;
  filter: FilterCard | null;
  setFilter: (f: FilterCard | null) => void;
}) {
  return (
    <div>
      <div className="mb-2.5 flex items-center justify-between">
        <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
          Scanned Breakdown · click to filter table
        </h3>
        {filter && (
          <button onClick={() => setFilter(null)} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground font-medium">
            <X className="h-3.5 w-3.5" /> Clear filter
          </button>
        )}
      </div>
      <div className="grid grid-cols-4 gap-3 sm:grid-cols-8">
        {/* Expected — info only */}
        <div className="rounded-xl border-2 border-blue-200 bg-blue-50 p-3.5 text-left">
          <div className="flex items-center gap-1.5 mb-2">
            <ClipboardList className="h-3.5 w-3.5 text-blue-700" />
            <span className="text-[11px] font-black uppercase tracking-wider text-blue-600 opacity-80">Expected</span>
          </div>
          <div className="text-4xl font-black tabular-nums leading-none text-blue-900">{totalExpected}</div>
        </div>
        {(["Priority","Fresh","UD","Refusal","RTO","Missing","Excess"] as LMFilterCard[]).map((card) => (
          <LMFilterPill
            key={card}
            card={card}
            count={lmCardCounts[card]}
            active={filter === card}
            onClick={() => setFilter(filter === card ? null : card)}
          />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// FM Breakdown Section
// ---------------------------------------------------------------------------

function FMBreakdownSection({ scannedCount, totalExpected, missing, excessCount, fmCardCounts, filter, setFilter }: {
  scannedCount: number; totalExpected: number; missing: number; excessCount: number;
  fmCardCounts: Record<FMFilterCard, number>; filter: FilterCard | null;
  setFilter: (f: FilterCard | null) => void;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <h3 className="mb-2.5 text-xs font-bold uppercase tracking-wider text-muted-foreground">Inventory KPIs</h3>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <KpiCard label="Expected" value={totalExpected} icon={ClipboardList} colorClass="border-blue-200 bg-blue-50 text-blue-900"     iconClass="text-blue-700"   labelClass="text-blue-600"   />
          <KpiCard label="Scanned"  value={scannedCount}  icon={ScanSearch}    colorClass="border-teal-200 bg-teal-50 text-teal-900"     iconClass="text-teal-700"   labelClass="text-teal-600"   />
          <KpiCard label="Missing"  value={missing}       icon={PackageX}      colorClass={missing    > 0 ? "border-red-200 bg-red-50 text-red-900" : "border-muted bg-muted/40 text-foreground"} iconClass={missing    > 0 ? "text-red-700"    : "text-muted-foreground"} labelClass={missing    > 0 ? "text-red-600"    : "text-muted-foreground"} />
          <KpiCard label="Excess"   value={excessCount}   icon={TriangleAlert} colorClass={excessCount > 0 ? "border-orange-200 bg-orange-50 text-orange-900" : "border-muted bg-muted/40 text-foreground"} iconClass={excessCount > 0 ? "text-orange-700" : "text-muted-foreground"} labelClass={excessCount > 0 ? "text-orange-600" : "text-muted-foreground"} />
        </div>
      </div>
      <div>
        <div className="mb-2.5 flex items-center justify-between">
          <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Status Breakdown · click to filter table</h3>
          {filter && (
            <button onClick={() => setFilter(null)} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground font-medium">
              <X className="h-3.5 w-3.5" /> Clear filter
            </button>
          )}
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {(["Rescheduled","Priority"] as FMFilterCard[]).map((card) => (
            <FMFilterPill key={card} card={card} count={fmCardCounts[card]} active={filter === card} onClick={() => setFilter(filter === card ? null : card)} />
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// KPI card (FM info-only)
// ---------------------------------------------------------------------------

function KpiCard({ label, value, icon: Icon, colorClass, iconClass, labelClass }: {
  label: string; value: number; icon: React.ComponentType<{ className?: string }>;
  colorClass: string; iconClass: string; labelClass: string;
}) {
  return (
    <div className={cn("rounded-xl border-2 p-3.5", colorClass)}>
      <div className="flex items-center gap-1.5 mb-2">
        <Icon className={cn("h-3.5 w-3.5", iconClass)} />
        <span className={cn("text-[11px] font-black uppercase tracking-wider opacity-80", labelClass)}>{label}</span>
      </div>
      <div className="text-4xl font-black tabular-nums leading-none">{value}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// LM Filter pill
// ---------------------------------------------------------------------------

const LM_CARD_LABELS: Record<LMFilterCard, string> = {
  Priority: "Priority", Fresh: "Fresh", UD: "Undelivered", Refusal: "Refusal", RTO: "RTO", Missing: "Missing", Excess: "Excess",
};

const LM_CARD_ICONS: Record<LMFilterCard, React.ComponentType<{ className?: string }>> = {
  Priority: Zap, Fresh: Sparkles, UD: RefreshCcw, Refusal: X, RTO: AlertOctagon, Missing: PackageSearch, Excess: TriangleAlert,
};

function LMFilterPill({ card, count, active, onClick }: {
  card: LMFilterCard; count: number; active: boolean; onClick: () => void;
}) {
  const c = LM_CARD_COLORS[card];
  const Icon = LM_CARD_ICONS[card];
  const isPriority = card === "Priority";
  return (
    <button onClick={onClick}
      className={cn(
        "rounded-xl border-2 p-3.5 text-left transition-all hover:-translate-y-0.5 hover:shadow-lg",
        c.bg, c.border, c.text,
        active && "ring-2 ring-primary ring-offset-2 ring-offset-background shadow-lg scale-[1.04]",
        isPriority && "border-[3px] shadow-md shadow-red-200",
      )}>
      <div className="flex items-center gap-1.5 mb-2">
        <Icon className={cn("h-3.5 w-3.5", isPriority && "animate-pulse")} />
        <span className={cn("text-[11px] font-black uppercase tracking-wider", isPriority ? "opacity-100" : "opacity-80")}>{LM_CARD_LABELS[card]}</span>
      </div>
      <div className={cn("text-4xl font-black tabular-nums leading-none", c.count)}>{count}</div>
    </button>
  );
}

// ---------------------------------------------------------------------------
// FM Filter pill
// ---------------------------------------------------------------------------

const FM_CARD_LABELS: Record<FMFilterCard, string> = { Rescheduled: "Rescheduled", Priority: "Priority" };
const FM_CARD_ICONS: Record<FMFilterCard, React.ComponentType<{ className?: string }>> = { Rescheduled: CalendarClock, Priority: Star };

function FMFilterPill({ card, count, active, onClick }: {
  card: FMFilterCard; count: number; active: boolean; onClick: () => void;
}) {
  const c = FM_CARD_COLORS[card];
  const Icon = FM_CARD_ICONS[card];
  return (
    <button onClick={onClick}
      className={cn("rounded-xl border-2 p-3.5 text-left transition-all hover:-translate-y-0.5 hover:shadow-lg",
        c.bg, c.border, c.text, active && "ring-2 ring-primary ring-offset-2 ring-offset-background shadow-lg scale-[1.04]")}>
      <div className="flex items-center gap-1.5 mb-2">
        <Icon className="h-3.5 w-3.5" />
        <span className="text-[11px] font-black uppercase tracking-wider opacity-80">{FM_CARD_LABELS[card]}</span>
      </div>
      <div className={cn("text-4xl font-black tabular-nums leading-none", c.count)}>{count}</div>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Shipment table
// ---------------------------------------------------------------------------

const ALL_FILTER_LABELS: Record<string, string> = {
  Priority: "Priority", Fresh: "Fresh", UD: "Undelivered", Refusal: "Refusal", RTO: "RTO",
  Missing: "Missing", Excess: "Excess", Rescheduled: "Rescheduled",
};

function ShipmentTable({ rows, filter, isMissingView, onClearFilter }: {
  rows: TableRow[]; filter: FilterCard | null; isMissingView: boolean; onClearFilter: () => void;
}) {
  return (
    <div className="rounded-xl border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-3">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-bold">{isMissingView ? "Missing Shipments" : "Shipments"}</h3>
          <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground tabular-nums">{rows.length}</span>
        </div>
        {filter && (
          <button onClick={onClearFilter}
            className="inline-flex items-center gap-1.5 rounded-full border bg-muted/60 px-3 py-1 text-xs font-bold hover:bg-muted">
            <span className="text-muted-foreground">Showing:</span> {ALL_FILTER_LABELS[filter] ?? filter} ({rows.length})
            <X className="h-3 w-3 ml-0.5" />
          </button>
        )}
      </div>
      <div className="max-h-[500px] overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-muted/80 text-[11px] uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-4 py-2.5 text-left font-bold">AWB</th>
              <th className="px-4 py-2.5 text-left font-bold">Status</th>
              <th className="px-4 py-2.5 text-left font-bold">Reason</th>
              <th className="px-4 py-2.5 text-right font-bold">Attempts</th>
              <th className="px-4 py-2.5 text-right font-bold">Days in Hub</th>
              {!isMissingView && <th className="px-4 py-2.5 text-left font-bold">Scanned At</th>}
              {isMissingView && <th className="px-4 py-2.5 text-left font-bold">Last Attempt Date</th>}
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 200).map((r) => {
              const isFreshAging = r.status === "Fresh" && r.daysInHub > 2;
              const isUDAging = (r.status === "Undelivered" || r.status === "Pending Attempt") && r.attempts < 3 && r.daysInHub > 2;
              const displayStatus = getDisplayStatus(r.status, r.isPriority);
              const badge = r.isPriority
                ? { bg: "bg-red-600", text: "text-white" }
                : STATUS_BADGE[r.status as keyof typeof STATUS_BADGE] ?? { bg: "bg-muted", text: "text-foreground" };
              return (
                <tr key={r.awb} className={cn(
                  "border-t hover:bg-muted/30 transition-colors",
                  r.isPriority && "bg-red-50/60",
                )}>
                  <td className="px-4 py-2.5 font-mono text-xs font-black">{r.awb}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex flex-wrap items-center gap-1">
                      <span className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[10px] font-black", badge.bg, badge.text)}>
                        {r.isPriority && <Zap className="h-2.5 w-2.5" />}
                        {displayStatus}
                      </span>
                      {isFreshAging && !r.isPriority && (
                        <span className="inline-flex items-center gap-0.5 rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-black text-red-700">
                          ⚠ Aging {r.daysInHub} Days
                        </span>
                      )}
                      {isUDAging && !r.isPriority && (
                        <span className="inline-flex items-center gap-0.5 rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-black text-red-700">
                          ⚠ Aging {r.daysInHub} Days
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground">{r.reason}</td>
                  <td className="px-4 py-2.5 text-right text-xs font-bold tabular-nums text-foreground">
                    {r.attempts > 0 ? r.attempts : "—"}
                  </td>
                  <td className={cn("px-4 py-2.5 text-right text-xs font-bold tabular-nums", (isFreshAging || isUDAging) ? "text-red-700" : "text-foreground")}>
                    {r.daysInHub || "—"}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-muted-foreground">
                    {isMissingView
                      ? (r.daysInHub ? lastAttemptDate(r.daysInHub) : "—")
                      : (r.scannedAt ?? "—")}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {rows.length > 200 && (
          <div className="border-t bg-muted/40 px-4 py-2 text-center text-xs text-muted-foreground">
            Showing first 200 of {rows.length} shipments
          </div>
        )}
        {rows.length === 0 && (
          <div className="py-12 text-center text-sm text-muted-foreground">
            {filter === "Missing" ? "All expected shipments scanned — no missing." : filter ? "No scanned shipments match this filter." : "No shipments scanned yet in this session."}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Latest scan card
// ---------------------------------------------------------------------------

const TONE_CLASSES: Record<StatusKey | "Excess", { card: string; label: string; awb: string; reason: string; meta: string; value: string; divider: string; badge: string; badgeText: string }> = {
  Fresh:             { card: "bg-emerald-50  border-emerald-200", label: "text-emerald-600", awb: "text-emerald-900", reason: "text-emerald-800", meta: "text-emerald-500", value: "text-emerald-900", divider: "border-emerald-200", badge: "bg-emerald-100", badgeText: "text-emerald-800" },
  "Pending Attempt": { card: "bg-amber-50    border-amber-200",   label: "text-amber-600",   awb: "text-amber-900",   reason: "text-amber-800",   meta: "text-amber-500",   value: "text-amber-900",   divider: "border-amber-200",   badge: "bg-amber-100",   badgeText: "text-amber-800"   },
  Undelivered:       { card: "bg-amber-50    border-amber-200",   label: "text-amber-600",   awb: "text-amber-900",   reason: "text-amber-800",   meta: "text-amber-500",   value: "text-amber-900",   divider: "border-amber-200",   badge: "bg-amber-100",   badgeText: "text-amber-800"   },
  Cancelled:         { card: "bg-red-50      border-red-200",     label: "text-red-600",     awb: "text-red-900",     reason: "text-red-800",     meta: "text-red-500",     value: "text-red-900",     divider: "border-red-200",     badge: "bg-red-100",     badgeText: "text-red-800"     },
  RTO:               { card: "bg-purple-50   border-purple-200",  label: "text-purple-600",  awb: "text-purple-900",  reason: "text-purple-800",  meta: "text-purple-500",  value: "text-purple-900",  divider: "border-purple-200",  badge: "bg-purple-100",  badgeText: "text-purple-800"  },
  Priority:          { card: "bg-pink-50     border-pink-200",    label: "text-pink-600",    awb: "text-pink-900",    reason: "text-pink-800",    meta: "text-pink-500",    value: "text-pink-900",    divider: "border-pink-200",    badge: "bg-pink-100",    badgeText: "text-pink-800"    },
  Rescheduled:       { card: "bg-sky-50      border-sky-200",     label: "text-sky-600",     awb: "text-sky-900",     reason: "text-sky-800",     meta: "text-sky-500",     value: "text-sky-900",     divider: "border-sky-200",     badge: "bg-sky-100",     badgeText: "text-sky-800"     },
  Missroute:         { card: "bg-orange-50   border-orange-200",  label: "text-orange-600",  awb: "text-orange-900",  reason: "text-orange-800",  meta: "text-orange-500",  value: "text-orange-900",  divider: "border-orange-200",  badge: "bg-orange-100",  badgeText: "text-orange-800"  },
  Excess:            { card: "bg-orange-50   border-orange-200",  label: "text-orange-600",  awb: "text-orange-900",  reason: "text-orange-800",  meta: "text-orange-500",  value: "text-orange-900",  divider: "border-orange-200",  badge: "bg-orange-100",  badgeText: "text-orange-800"  },
};

function LatestScanCard({ latest }: { latest: ScanRecord | undefined }) {
  if (!latest) {
    return (
      <div className="flex h-full min-h-[220px] flex-col items-center justify-center rounded-xl border-2 border-dashed bg-card p-8 text-center">
        <div className="grid h-16 w-16 place-items-center rounded-full bg-muted">
          <ScanLine className="h-8 w-8 text-muted-foreground" />
        </div>
        <h3 className="mt-4 text-lg font-bold">Awaiting first scan</h3>
        <p className="mt-1 max-w-xs text-sm text-muted-foreground">
          Scan an AWB to see shipment details — status, reason, and days in hub.
        </p>
      </div>
    );
  }

  const baseTone   = TONE_CLASSES[latest.status] ?? TONE_CLASSES["Fresh"];
  const Icon       = STATUS_ICON[latest.status];
  const isFresh    = latest.status === "Fresh";
  const isUD       = latest.status === "Undelivered" || latest.status === "Pending Attempt";
  const isFreshAging = isFresh && latest.daysInHub > 2;
  const isUDAging    = isUD && latest.attempts < 3 && latest.daysInHub > 2;
  const isAging      = (isFreshAging || isUDAging) && !latest.isPriority;

  const agingTone = {
    card: "bg-red-50 border-red-400", label: "text-red-600", awb: "text-red-900", reason: "text-red-800",
    meta: "text-red-500", value: "text-red-900", divider: "border-red-200", badge: "bg-red-100", badgeText: "text-red-800",
  };
  const tone = isAging ? agingTone : baseTone;

  const displayStatus = getDisplayStatus(latest.status, latest.isPriority);

  return (
    <div className={cn(
      "h-full rounded-xl border-2 p-6 flex flex-col justify-between",
      tone.card,
      latest.isPriority && "border-[3px] border-red-500 shadow-lg shadow-red-200/60",
    )}>
      <div className="flex items-start justify-between gap-4">
        <div className={cn("flex items-center gap-2 text-xs font-bold uppercase tracking-wider", latest.isPriority ? "text-red-700" : tone.label)}>
          <CheckCircle2 className="h-3.5 w-3.5" /> Last Scanned
        </div>
        <div className="flex items-center gap-2">
          {isAging && (
            <span className="inline-flex items-center gap-1 rounded-full bg-red-100 border border-red-300 px-2.5 py-1 text-xs font-black text-red-700">
              ⚠ Aging {latest.daysInHub} Days
            </span>
          )}
          <span className={cn(
            "inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-sm font-black",
            latest.isPriority ? "bg-red-600 text-white" : cn(tone.badge, tone.badgeText),
          )}>
            {latest.isPriority && <Zap className="h-4 w-4 animate-pulse" />}
            {!latest.isPriority && <Icon className="h-4 w-4" />}
            {displayStatus}
          </span>
        </div>
      </div>

      <div className={cn("mt-2 font-mono text-[52px] font-black tracking-tight leading-none break-all", latest.isPriority ? "text-red-900" : tone.awb)}>
        {latest.awb}
      </div>

      <div className={cn("mt-3 text-2xl font-black", latest.isPriority ? "text-red-800" : tone.reason)}>{latest.reason}</div>

      <div className={cn("mt-4 flex flex-wrap gap-x-6 gap-y-2 border-t pt-4", tone.divider)}>
        {latest.attempts > 0 && (
          <div>
            <div className={cn("text-[11px] font-bold uppercase tracking-wider", tone.meta)}>Attempts</div>
            <div className={cn("mt-0.5 text-lg font-black", tone.value)}>{latest.attempts}</div>
          </div>
        )}
        {!isFresh && (
          <>
            <div>
              <div className={cn("text-[11px] font-bold uppercase tracking-wider", tone.meta)}>Days in Hub</div>
              <div className={cn("mt-0.5 text-lg font-black", tone.value)}>
                {latest.daysInHub} {latest.daysInHub === 1 ? "Day" : "Days"}
              </div>
            </div>
            <div>
              <div className={cn("text-[11px] font-bold uppercase tracking-wider", tone.meta)}>Last Attempt</div>
              <div className={cn("mt-0.5 text-lg font-black", tone.value)}>{lastAttemptDate(latest.daysInHub)}</div>
            </div>
          </>
        )}
        {isFreshAging && (
          <div>
            <div className={cn("text-[11px] font-bold uppercase tracking-wider", tone.meta)}>Days in Hub</div>
            <div className={cn("mt-0.5 text-lg font-black", tone.value)}>
              {latest.daysInHub} {latest.daysInHub === 1 ? "Day" : "Days"}
            </div>
          </div>
        )}
        <div>
          <div className={cn("text-[11px] font-bold uppercase tracking-wider", tone.meta)}>Scanned At</div>
          <div className={cn("mt-0.5 text-lg font-black", tone.value)}>{latest.scannedAt}</div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Bottom metric
// ---------------------------------------------------------------------------

function BottomMetric({ label, value, color }: { label: string; value: number | string; color?: string }) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{label}</span>
      <span className={cn("text-base font-black tabular-nums", color ?? "text-foreground")}>{value}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// History view
// ---------------------------------------------------------------------------

function HistoryView({ isSessionActive, activeSessionId, scannedCount, missingCount, sessionHistory, onContinue, onViewSummary, onReopen, onDownloadCsv }: {
  isSessionActive: boolean; activeSessionId: string; scannedCount: number; missingCount: number;
  sessionHistory: Session[]; onContinue: () => void; onViewSummary: (s: Session) => void;
  onReopen: (id: string) => void; onDownloadCsv: (s: Session) => void;
}) {
  return (
    <div className="p-6 space-y-6">
      {isSessionActive && (
        <section>
          <h2 className="mb-2 text-xs font-black uppercase tracking-wider text-muted-foreground">Active Session</h2>
          <div className="rounded-xl border-2 border-purple-200 bg-purple-50 p-5">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-2 text-xs font-bold text-purple-700">
                  <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-purple-500" /> Active
                </div>
                <div className="mt-1 font-mono text-lg font-black">{activeSessionId}</div>
                <div className="mt-2 flex items-center gap-5">
                  <span className="text-sm font-bold text-teal-700">{scannedCount} Scanned</span>
                  <span className={cn("text-sm font-bold", missingCount > 0 ? "text-red-700" : "text-muted-foreground")}>
                    {missingCount} Missing
                  </span>
                </div>
              </div>
              <button onClick={onContinue}
                className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-bold text-primary-foreground hover:bg-primary/90 shadow-sm">
                Continue Scanning <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        </section>
      )}

      <section>
        <h2 className="mb-2 text-xs font-black uppercase tracking-wider text-muted-foreground">Scan Tally History</h2>
        <div className="rounded-xl border bg-card overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/60 text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-5 py-3 text-left font-bold">Session Name</th>
                <th className="px-5 py-3 text-left font-bold">Status</th>
                <th className="px-5 py-3 text-left font-bold">Summary</th>
                <th className="px-5 py-3 text-right font-bold">Actions</th>
              </tr>
            </thead>
            <tbody>
              {sessionHistory.map((s) => {
                const badge = SESSION_STATUS_BADGE[s.status];
                return (
                  <tr key={s.id} className="border-t hover:bg-muted/20 transition-colors">
                    <td className="px-5 py-4 font-mono text-sm font-black">{s.id}</td>
                    <td className="px-5 py-4">
                      <span className={cn("inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-black", badge.bg, badge.text)}>
                        <span className={cn("inline-block h-1.5 w-1.5 rounded-full", badge.dot)} />
                        {badge.label}
                      </span>
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex flex-wrap gap-1.5">
                        <SummaryChip label="Scanned" value={s.scanned} color="bg-teal-100 text-teal-800" />
                        <SummaryChip label="Missing" value={s.missing} color={s.missing > 0 ? "bg-red-100 text-red-800" : "bg-muted text-muted-foreground"} />
                        {s.excess > 0 && <SummaryChip label="Excess" value={s.excess} color="bg-orange-100 text-orange-800" />}
                        <SummaryChip label="Acc" value={`${s.accuracy}%`} color="bg-purple-100 text-purple-800" />
                      </div>
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex items-center justify-end gap-2">
                        <button onClick={() => onViewSummary(s)}
                          className="inline-flex items-center gap-1.5 rounded-md border bg-muted/50 px-3 py-1.5 text-xs font-bold hover:bg-muted transition-colors">
                          <ListChecks className="h-3.5 w-3.5" /> View Summary
                        </button>
                        <button onClick={() => onDownloadCsv(s)}
                          className="inline-flex items-center gap-1.5 rounded-md border bg-muted/50 px-3 py-1.5 text-xs font-bold hover:bg-muted transition-colors">
                          <Download className="h-3.5 w-3.5" /> Download Excel
                        </button>
                        {s.status === "Completed" && (
                          <button onClick={() => onReopen(s.id)}
                            className="inline-flex items-center gap-1.5 rounded-md border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-bold text-amber-700 hover:bg-amber-100 transition-colors">
                            <RotateCcw className="h-3.5 w-3.5" /> Reopen
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
              {sessionHistory.length === 0 && (
                <tr><td colSpan={4} className="py-12 text-center text-sm text-muted-foreground">No completed sessions yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Summary chip
// ---------------------------------------------------------------------------

function SummaryChip({ label, value, color }: { label: string; value: number | string; color: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-bold", color)}>
      {label} <span className="tabular-nums">{value}</span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Summary popup
// ---------------------------------------------------------------------------

function SummaryPopup({ session, onClose, onDownload }: {
  session: Session; onClose: () => void; onDownload: (s: Session) => void;
}) {
  const items = [
    { l: "Expected", v: session.expected, bg: "bg-blue-50",    text: "text-blue-900",    border: "border-blue-200",    I: ClipboardList },
    { l: "Scanned",  v: session.scanned,  bg: "bg-teal-50",   text: "text-teal-900",   border: "border-teal-200",   I: PackageCheck  },
    { l: "Missing",  v: session.missing,  bg: "bg-red-50",    text: "text-red-900",    border: "border-red-200",    I: PackageX      },
    { l: "Excess",   v: session.excess,   bg: "bg-orange-50", text: "text-orange-900", border: "border-orange-200", I: TriangleAlert },
    { l: "Accuracy", v: `${session.accuracy}%`, bg: "bg-purple-50", text: "text-purple-900", border: "border-purple-200", I: TrendingUp },
  ];
  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-foreground/50 p-4 backdrop-blur-sm">
      <div className="w-full max-w-xl rounded-2xl border bg-card shadow-2xl">
        <div className="flex items-center justify-between border-b px-6 py-4">
          <div>
            <h3 className="text-base font-black">Reconciliation Report</h3>
            <p className="text-xs text-muted-foreground mt-0.5 font-mono font-semibold">{session.id}</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => onDownload(session)}
              className="inline-flex items-center gap-2 rounded-lg border px-3.5 py-1.5 text-xs font-bold hover:bg-muted">
              <FileSpreadsheet className="h-3.5 w-3.5" /> Download Excel
            </button>
            <button onClick={onClose} className="rounded-md p-1.5 text-muted-foreground hover:bg-muted">
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3 p-6 md:grid-cols-5">
          {items.map((i) => (
            <div key={i.l} className={cn("rounded-xl border-2 p-4", i.bg, i.text, i.border)}>
              <i.I className="h-5 w-5 opacity-70" />
              <div className="mt-2 text-3xl font-black tabular-nums">{i.v}</div>
              <div className="mt-0.5 text-[11px] font-bold uppercase tracking-wider opacity-60">{i.l}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Complete modal
// ---------------------------------------------------------------------------

function CompleteModal({ expected, scanned, missing, excess, accuracy, missingItems, onCancel, onContinueScanning, onComplete, onDownloadInterim }: {
  expected: number; scanned: number; missing: number; excess: number; accuracy: number;
  missingItems: ExpectedShipment[];
  onCancel: () => void; onContinueScanning: () => void; onComplete: () => void; onDownloadInterim: () => void;
}) {
  const [showMissingList, setShowMissingList] = useState(false);
  const hasMissing = missing > 0;
  const rows = [
    { l: "Expected", v: expected,      bg: "bg-blue-50",    text: "text-blue-900",    border: "border-blue-200"    },
    { l: "Scanned",  v: scanned,       bg: "bg-teal-50",   text: "text-teal-900",   border: "border-teal-200"   },
    { l: "Missing",  v: missing,       bg: "bg-red-50",    text: "text-red-900",    border: "border-red-200"    },
    { l: "Excess",   v: excess,        bg: "bg-orange-50", text: "text-orange-900", border: "border-orange-200" },
    { l: "Accuracy", v: `${accuracy}%`,bg: "bg-purple-50", text: "text-purple-900", border: "border-purple-200" },
  ];

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-foreground/50 p-4 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-2xl border bg-card shadow-2xl">
        <div className="flex items-center justify-between border-b px-6 py-4">
          <h3 className="text-base font-black">Complete Scan Tally?</h3>
          <button onClick={onCancel} className="rounded-md p-1.5 text-muted-foreground hover:bg-muted">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="p-6 space-y-3">
          {hasMissing && (
            <div className="flex items-start gap-3 rounded-xl border-2 border-red-200 bg-red-50 p-4 text-red-800">
              <AlertTriangle className="h-5 w-5 mt-0.5 shrink-0 text-red-600" />
              <div className="flex-1 min-w-0">
                <div className="font-black text-sm">{missing} shipment{missing === 1 ? "" : "s"} still missing from inventory.</div>
                <div className="mt-0.5 text-xs opacity-80">Continue scanning to improve accuracy, or complete now.</div>
                {missingItems.length > 0 && (
                  <button
                    onClick={() => setShowMissingList((v) => !v)}
                    className="mt-2 inline-flex items-center gap-1 text-xs font-black underline underline-offset-2 hover:opacity-70"
                  >
                    {showMissingList ? "Hide" : "View"} missing AWB list ({missing})
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Missing AWB list */}
          {showMissingList && missingItems.length > 0 && (
            <div className="rounded-xl border border-rose-200 bg-rose-50 overflow-hidden">
              <div className="border-b border-rose-200 px-4 py-2 flex items-center justify-between">
                <span className="text-xs font-black uppercase tracking-wider text-rose-700">Missing AWBs</span>
                <span className="text-xs font-semibold text-rose-600">{missingItems.length} total</span>
              </div>
              <div className="max-h-52 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-rose-100 text-[10px] uppercase tracking-wider text-rose-600">
                    <tr>
                      <th className="px-3 py-2 text-left font-bold">AWB</th>
                      <th className="px-3 py-2 text-left font-bold">Status</th>
                      <th className="px-3 py-2 text-right font-bold">Attempts</th>
                      <th className="px-3 py-2 text-right font-bold">Days</th>
                    </tr>
                  </thead>
                  <tbody>
                    {missingItems.slice(0, 100).map((s) => (
                      <tr key={s.awb} className="border-t border-rose-100 hover:bg-rose-100/60">
                        <td className="px-3 py-1.5 font-mono font-black text-rose-900">{s.awb}</td>
                        <td className="px-3 py-1.5 text-rose-700">{s.status === "Pending Attempt" ? "Undelivered" : s.status}</td>
                        <td className="px-3 py-1.5 text-right font-bold tabular-nums text-rose-800">{s.attempts || "—"}</td>
                        <td className={cn("px-3 py-1.5 text-right font-bold tabular-nums", s.daysInHub >= 3 ? "text-red-700" : "text-rose-800")}>{s.daysInHub || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {missingItems.length > 100 && (
                  <div className="border-t border-rose-200 bg-rose-100/60 px-3 py-2 text-center text-[10px] text-rose-600">
                    Showing first 100 of {missingItems.length}
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="grid grid-cols-5 gap-2">
            {rows.map((r) => (
              <div key={r.l} className={cn("rounded-xl border-2 p-3 text-center", r.bg, r.text, r.border)}>
                <div className="text-2xl font-black tabular-nums">{r.v}</div>
                <div className="mt-0.5 text-[10px] font-black uppercase tracking-wider opacity-60">{r.l}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t px-6 py-4">
          <button onClick={onDownloadInterim}
            className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-bold text-muted-foreground hover:bg-muted hover:text-foreground">
            <Download className="h-3.5 w-3.5" /> Download Interim Excel
          </button>
          <div className="flex items-center gap-2">
            <button onClick={onContinueScanning} className="rounded-lg border px-4 py-2 text-sm font-bold hover:bg-muted">
              Continue Scanning
            </button>
            <button onClick={onComplete}
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2 text-sm font-bold text-primary-foreground hover:bg-primary/90">
              Complete <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function triggerDownload(content: string, filename: string) {
  const blob = new Blob([content], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}
