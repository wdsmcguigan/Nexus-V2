import { Component, type ReactNode } from "react";
import { Workspace } from "@/components/Workspace";

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
  return (
    <ErrorBoundary>
      <Workspace />
    </ErrorBoundary>
  );
}
