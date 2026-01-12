export default function DashboardLoading() {
  return (
    <div className="min-h-screen bg-white">
      {/* Simple sidebar placeholder */}
      <div className="fixed left-0 top-0 h-full w-64 border-r-2 border-black bg-white" />

      {/* Main content area */}
      <div className="ml-64 p-4">
        <div className="max-w-7xl mx-auto">
          {/* Page Header */}
          <div className="mb-6">
            <h1 className="text-3xl font-mono font-bold">Dashboard</h1>
            <p className="text-gray-600 mt-1">Loading your workspace...</p>
          </div>

          {/* Stats Bar Skeleton */}
          <div className="border-2 border-black p-2 mb-4 flex items-center gap-6">
            {[1, 2, 3, 4].map(i => (
              <div key={i} className="flex items-center gap-2">
                <div className="w-4 h-4 bg-gray-200 animate-pulse" />
                <div className="flex items-baseline gap-1.5">
                  <div className="w-24 h-4 bg-gray-200 animate-pulse" />
                  <div className="w-12 h-5 bg-gray-300 animate-pulse" />
                </div>
              </div>
            ))}
          </div>

          {/* Header Skeleton */}
          <div className="flex items-center justify-between mb-3">
            <div className="w-40 h-4 bg-gray-200 animate-pulse" />
            <div className="flex items-center gap-2">
              <div className="w-32 h-10 bg-gray-200 animate-pulse" />
              <div className="w-40 h-10 bg-gray-200 animate-pulse" />
            </div>
          </div>

          {/* Workflow Cards Skeleton */}
          <div className="border-2 border-black divide-y divide-gray-200 mb-4">
            {[1, 2, 3, 4, 5].map(i => (
              <div key={i} className="p-2">
                <div className="flex items-center gap-2 min-w-0">
                  {/* Name and status */}
                  <div className="flex items-center gap-2 min-w-[200px] max-w-[320px] flex-shrink">
                    <div className="w-32 h-5 bg-gray-200 animate-pulse" />
                    <div className="w-12 h-4 bg-gray-300 animate-pulse" />
                  </div>

                  <div className="text-gray-300">|</div>

                  {/* Metrics */}
                  <div className="flex items-center gap-2 flex-1">
                    <div className="w-16 h-4 bg-gray-200 animate-pulse" />
                    <div className="w-12 h-4 bg-gray-200 animate-pulse" />
                    <div className="w-12 h-4 bg-gray-200 animate-pulse" />
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2 ml-auto">
                    <div className="w-16 h-8 bg-gray-200 animate-pulse" />
                    <div className="w-20 h-8 bg-gray-200 animate-pulse" />
                    <div className="w-8 h-8 bg-gray-200 animate-pulse" />
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Loading indicator */}
          <div className="flex items-center justify-center py-8">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-black" />
          </div>
        </div>
      </div>
    </div>
  );
}
