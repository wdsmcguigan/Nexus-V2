import { Component, useState, useEffect, type ReactNode } from "react";
import { Workspace } from "@/components/Workspace";
import { VaultSetup } from "@/components/onboarding/VaultSetup";
import { isTauri, getVaultPath, repairMessageBodies } from "@/storage/tauri";
import { bodyStore } from "@/storage/bodyStore";

interface ErrorBoundaryState {
  error: Error | null;
}

class ErrorBoundary extends Component<{ children: ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex h-screen w-screen flex-col items-center justify-center gap-4 bg-[#0e0e0e] p-8 font-mono text-[#e5e5e5]">
          <h1 className="text-2xl font-bold text-red-400">Something went wrong</h1>
          <pre className="max-w-2xl overflow-auto rounded bg-[#1a1a1a] p-4 text-sm text-red-300">
            {this.state.error.message}
            {"\n\n"}
            {this.state.error.stack}
          </pre>
          <button
            onClick={() => window.location.reload()}
            className="rounded bg-[#2a2a2a] px-4 py-2 text-sm hover:bg-[#3a3a3a]"
          >
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  const [showOnboarding, setShowOnboarding] = useState<boolean | null>(null);

  useEffect(() => {
    if (!isTauri()) {
      setShowOnboarding(false);
      return;
    }
    getVaultPath().then((path) => {
      const pendingStep = localStorage.getItem("nexus-onboarding-step");
      const hasPendingStep = pendingStep === "mode" || pendingStep === "gmail";
      setShowOnboarding(!path || hasPendingStep);
      if (path && !hasPendingStep) {
        repairMessageBodies().then(() => bodyStore.clear()).catch(() => {});
      }
    });
  }, []);

  // Loading state while we check for an existing vault
  if (showOnboarding === null) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-neutral-950" />
    );
  }

  if (showOnboarding) {
    return (
      <ErrorBoundary>
        <VaultSetup onComplete={() => setShowOnboarding(false)} />
      </ErrorBoundary>
    );
  }

  return (
    <ErrorBoundary>
      <Workspace />
    </ErrorBoundary>
  );
}
