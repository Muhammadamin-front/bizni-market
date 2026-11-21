import { cn } from "../cn";

/** A loading placeholder block. Pulses only until content arrives; stays still under reduced motion. */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("animate-pulse rounded-control bg-sunken motion-reduce:animate-none", className)} />;
}

/** Same footprint as ProductCard so the grid does not jump when data arrives. */
export function ProductCardSkeleton() {
  return (
    <div aria-hidden className="flex flex-col overflow-hidden rounded-card border border-line bg-card">
      <Skeleton className="aspect-square rounded-none" />
      <div className="flex flex-col gap-2 p-3">
        <Skeleton className="h-3 w-1/3" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-2/3" />
        <Skeleton className="mt-2 h-6 w-1/2" />
        <Skeleton className="h-4 w-2/5" />
        <Skeleton className="mt-2 h-11 w-full" />
      </div>
    </div>
  );
}
