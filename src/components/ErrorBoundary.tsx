"use client";

import { Component, type ReactNode } from "react";
import { reportError } from "@/lib/report-error";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

// Catches render-time crashes anywhere in the tree instead of leaving the
// user on a blank white screen with no way back in.
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error) {
    reportError(error, { where: "ErrorBoundary" });
  }

  render() {
    if (this.state.error) {
      return (
        <main className="flex flex-1 flex-col items-center justify-center gap-4 px-8 text-center">
          <h1 className="text-lg font-bold">Something went wrong</h1>
          <p className="text-sm text-neutral-400">
            The app hit an unexpected error. Your clips and blueprints are safe in local storage.
          </p>
          <button
            onClick={() => (window.location.href = "/home")}
            className="btn-primary px-6 py-3"
          >
            Back to home
          </button>
        </main>
      );
    }
    return this.props.children;
  }
}
