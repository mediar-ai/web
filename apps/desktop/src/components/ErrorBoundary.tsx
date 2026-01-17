import * as Sentry from "@sentry/react";
import React from "react";

interface ErrorBoundaryState {
  hasError: boolean;
  error?: Error;
}

interface ErrorBoundaryProps {
  children: React.ReactNode;
  fallback?: React.ComponentType<{ error: Error; resetError: () => void }>;
}

class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    // Update state so the next render will show the fallback UI
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    // Log the error to Sentry
    Sentry.withScope((scope) => {
      scope.setTag("errorBoundary", true);
      scope.setContext("errorInfo", {
        componentStack: errorInfo.componentStack,
      } as any);
      scope.setLevel("error");
      Sentry.captureException(error);
    });

    console.error("Error Boundary caught an error:", error, errorInfo);
  }

  resetError = () => {
    this.setState({ hasError: false, error: undefined });
  };

  render() {
    if (this.state.hasError && this.state.error) {
      // You can render any custom fallback UI
      if (this.props.fallback) {
        const FallbackComponent = this.props.fallback;
        return <FallbackComponent error={this.state.error} resetError={this.resetError} />;
      }

      return (
        <div className="min-h-screen bg-white p-8 flex items-center justify-center">
          <div className="max-w-md mx-auto text-center">
            <div className="mb-6">
              <div className="w-16 h-16 border-2 border-black rounded-full flex items-center justify-center mx-auto mb-4">
                <svg className="w-8 h-8 text-black" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
                </svg>
              </div>
              <h2 className="text-2xl font-bold text-black mb-2">Something went wrong</h2>
              <p className="text-black/70 mb-6">
                An unexpected error occurred. The error has been reported and will be investigated.
              </p>
            </div>

            <div className="space-y-4">
              <button
                onClick={this.resetError}
                className="w-full bg-black text-white hover:bg-black/90 font-medium py-2 px-4 rounded-lg transition-colors"
              >
                Try Again
              </button>

              <button
                onClick={() => window.location.reload()}
                className="w-full bg-black text-white hover:bg-black/90 font-medium py-2 px-4 rounded-lg transition-colors"
              >
                Reload App
              </button>
            </div>

            {process.env.NODE_ENV === "development" && (
              <details className="mt-6 text-left">
                <summary className="cursor-pointer text-sm text-black/70 hover:text-black">
                  Show Error Details (Development)
                </summary>
                <pre className="mt-2 p-4 bg-white border-2 border-black rounded text-xs text-black overflow-auto">
                  {this.state.error.toString()}
                  {this.state.error.stack}
                </pre>
              </details>
            )}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

// Create a Sentry-enhanced Error Boundary
export const SentryErrorBoundary = Sentry.withErrorBoundary(ErrorBoundary, {
  fallback: ({ resetError }) => (
    <div className="min-h-screen bg-white p-8 flex items-center justify-center">
      <div className="max-w-md mx-auto text-center">
        <div className="mb-6">
          <div className="w-16 h-16 border-2 border-black rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-black" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
          </div>
          <h2 className="text-2xl font-bold text-black mb-2">Something went wrong</h2>
          <p className="text-black/70 mb-6">
            An unexpected error occurred. The error has been automatically reported.
          </p>
        </div>

        <div className="space-y-4">
          <button
            onClick={resetError}
            className="w-full bg-black text-white hover:bg-black/90 font-medium py-2 px-4 rounded-lg transition-colors"
          >
            Try Again
          </button>

          <button
            onClick={() => window.location.reload()}
            className="w-full bg-black text-white hover:bg-black/90 font-medium py-2 px-4 rounded-lg transition-colors"
          >
            Reload App
          </button>
        </div>
      </div>
    </div>
  ),
});

/**
 * Specific error fallback for chat interface
 */
export const ChatErrorFallback = ({ error, resetError }: { error: Error; resetError: () => void }) => (
  <div className="flex flex-col items-center justify-center h-full p-10 text-center">
    <div className="text-5xl mb-4">💬</div>
    <h2 className="text-xl font-bold text-black mb-2">Chat Error</h2>
    <p className="text-black/70 mb-6 max-w-md">
      The chat interface encountered an error. You can try again or refresh the page.
    </p>
    {process.env.NODE_ENV === 'development' && (
      <details className="mb-6 text-left max-w-md w-full">
        <summary className="cursor-pointer text-sm text-black/70 hover:text-black">
          Error details
        </summary>
        <pre className="mt-2 p-4 bg-white border-2 border-black rounded text-xs text-black overflow-auto">
          {error.message}
          {'\n\n'}
          {error.stack}
        </pre>
      </details>
    )}
    <div className="space-x-4">
      <button
        onClick={resetError}
        className="bg-black text-white hover:bg-black/90 font-medium py-2 px-6 rounded-lg transition-colors"
      >
        Try Again
      </button>
      <button
        onClick={() => window.location.reload()}
        className="bg-black text-white hover:bg-black/90 font-medium py-2 px-6 rounded-lg transition-colors"
      >
        Refresh Page
      </button>
    </div>
  </div>
);

/**
 * Specific error fallback for MCP server
 */
export const McpErrorFallback = ({ error, resetError }: { error: Error; resetError: () => void }) => (
  <div className="p-5 bg-white border-2 border-black rounded-lg m-5">
    <div className="text-3xl mb-3">⚠️</div>
    <h3 className="text-lg font-bold text-black mb-2">MCP Server Error</h3>
    <p className="text-black/70 mb-4">
      The MCP server connection encountered an error. This may affect tool execution.
    </p>
    <p className="text-sm text-black/60 mb-4">
      Please check that the MCP servers are running on ports 8080 and 8081.
    </p>
    {process.env.NODE_ENV === 'development' && (
      <details className="mb-4">
        <summary className="cursor-pointer text-sm text-black/70 hover:text-black">
          Error details
        </summary>
        <pre className="mt-2 p-3 bg-white border border-black rounded text-xs text-black overflow-auto">
          {error.message}
        </pre>
      </details>
    )}
    <button
      onClick={resetError}
      className="bg-black text-white hover:bg-black/90 font-medium py-2 px-4 rounded transition-colors"
    >
      Retry Connection
    </button>
  </div>
);

/**
 * Specific error fallback for workflow execution
 */
export const WorkflowErrorFallback = ({ error, resetError }: { error: Error; resetError: () => void }) => (
  <div className="p-5 bg-white border-2 border-black rounded-lg m-5">
    <div className="text-3xl mb-3">🔧</div>
    <h3 className="text-lg font-bold text-black mb-2">Workflow Execution Error</h3>
    <p className="text-black/70 mb-4">
      A workflow step encountered an error during execution.
    </p>
    {process.env.NODE_ENV === 'development' && (
      <details className="mb-4">
        <summary className="cursor-pointer text-sm text-black/70 hover:text-black">
          Error details
        </summary>
        <pre className="mt-2 p-3 bg-white border border-black rounded text-xs text-black overflow-auto max-h-40">
          {error.message}
          {'\n\n'}
          {error.stack}
        </pre>
      </details>
    )}
    <button
      onClick={resetError}
      className="bg-black text-white hover:bg-black/90 font-medium py-2 px-4 rounded transition-colors"
    >
      Reset Workflow
    </button>
  </div>
);

export default ErrorBoundary;
