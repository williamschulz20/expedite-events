"use client";

import { useEffect, useState } from "react";

export type SetupStatus = { attribution: boolean; grading: boolean };

// One request per page load, shared by every popup that asks.
let pending: Promise<SetupStatus> | null = null;

function load(): Promise<SetupStatus> {
  pending ??= fetch("/api/setup-status")
    .then((r) => (r.ok ? r.json() : { attribution: false, grading: false }))
    .catch(() => ({ attribution: false, grading: false }));
  return pending;
}

/** Null while loading. */
export function useSetupStatus(): SetupStatus | null {
  const [status, setStatus] = useState<SetupStatus | null>(null);
  useEffect(() => {
    let live = true;
    load().then((s) => live && setStatus(s));
    return () => {
      live = false;
    };
  }, []);
  return status;
}
