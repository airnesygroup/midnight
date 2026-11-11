import { LoaderBlock, PageLoader } from "@/components/loader";
import { Newspaper, SearchX } from "lucide-react";

/** Compact in-layout placeholder when one block has no stories; keeps the card's shape. */
export function EmptyCard({ text = "No stories here yet.", icon = "news", className = "" }: { text?: string; icon?: "news" | "search"; className?: string }) {
  const Icon = icon === "search" ? SearchX : Newspaper;
  return (
    <div role="status" className={`empty-card ${className}`}>
      <Icon className="h-6 w-6 text-muted-foreground" />
      <p className="text-sm font-semibold text-muted-foreground">{text}</p>
    </div>
  );
}

/** Inline loading state for a list block. */
export function RowSkeleton() {
  return <LoaderBlock size="sm" className="py-6" />;
}

/** Shown while a page's data is on its way. */
export function PageSkeleton() {
  return <PageLoader />;
}
