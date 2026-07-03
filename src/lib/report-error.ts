// Pluggable error reporting. Today this just logs to the console — there is
// no Sentry (or similar) account wired up, and that's a real decision for
// whoever operates this in production to make, not something to fake with
// a placeholder DSN.
//
// The point of routing every catch through this one function instead of
// scattering `console.error` calls is that turning on real monitoring later
// is a one-file change:
//
//   import * as Sentry from "@sentry/nextjs";
//   export function reportError(error: unknown, context?: Record<string, unknown>) {
//     Sentry.captureException(error, { extra: context });
//   }
//
// Call this from catch blocks that represent genuine failures worth
// knowing about in production (a render that crashed, an API route that
// threw) — not from expected/handled cases like "no AI key configured" or
// a validation error already shown to the user.
export function reportError(error: unknown, context?: Record<string, unknown>): void {
  console.error("[reportError]", error, context ?? "");
}
