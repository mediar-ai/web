'use client';

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  children?: React.ReactNode;
}

export function PageHeader({ title, subtitle, children }: PageHeaderProps) {
  return (
    <div className="flex items-start justify-between mb-6">
      <div>
        <h1 className="text-2xl font-bold font-mono">{title}</h1>
        {subtitle && (
          <p className="text-muted-foreground text-sm mt-1">{subtitle}</p>
        )}
      </div>

      {/* Additional actions passed as children */}
      {children && (
        <div className="flex items-center gap-4">
          {children}
        </div>
      )}
    </div>
  );
}