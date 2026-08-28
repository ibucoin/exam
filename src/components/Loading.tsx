import { LoaderCircle } from "lucide-react";

export function Loading({ label = "正在加载" }: { label?: string }) {
  return (
    <div className="loading" role="status">
      <LoaderCircle className="spin" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

export function EmptyState({ children }: { children: React.ReactNode }) {
  return <div className="empty-state">{children}</div>;
}
