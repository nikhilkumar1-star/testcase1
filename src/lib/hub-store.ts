import { useSyncExternalStore } from "react";

export type HubKind = "Sorting" | "LM" | "FM";
export type Hub = { id: string; name: string; kind: HubKind };

export const HUBS: Hub[] = [
  { id: "delhi-sort-1", name: "Delhi Sorting Hub-1", kind: "Sorting" },
  { id: "uttam-nagar-lm", name: "Uttam Nagar LM Warehouse", kind: "LM" },
  { id: "rohini-fm", name: "Rohini FM Warehouse", kind: "FM" },
];

let current: Hub = HUBS[0];
const listeners = new Set<() => void>();

function subscribe(l: () => void) {
  listeners.add(l);
  return () => listeners.delete(l);
}
function getSnapshot() {
  return current;
}

export function setHub(hub: Hub) {
  current = hub;
  listeners.forEach((l) => l());
}

export function useHub(): Hub {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** Derived operational mode: FM warehouse → FM, otherwise LM (Sorting defaults to LM tally). */
export function modeForHub(hub: Hub): "FM" | "LM" {
  return hub.kind === "FM" ? "FM" : "LM";
}
