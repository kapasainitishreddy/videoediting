"use client";

import { useEffect } from "react";

// Registers /public/sw.js. Skipped in dev: HMR rewrites assets constantly,
// and a service worker intercepting those requests is a classic source of
// "why isn't my change showing up" confusion during development.
export default function ServiceWorkerRegistrar() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // offline support is a progressive enhancement — a failed
      // registration should never block the app from working online
    });
  }, []);
  return null;
}
