import { useId } from "react";

/**
 * A share of a whole, drawn as a flat bar with its figure in words above it.
 *
 * Graphite on a hairline-grey track, square, no blue: progress is a reading,
 * not a link, and blue in the transcript already means "a call is running".
 * The label carries the number, so the fill is never the only channel, and
 * screen readers get the same sentence as `aria-valuetext`. An empty whole
 * (`max` 0) draws an empty track rather than dividing by zero.
 */
export function ProgressBar({
  value,
  max,
  label,
}: {
  value: number;
  max: number;
  label: string;
}) {
  const labelId = useId();
  const percent =
    max > 0 ? Math.round((Math.min(Math.max(value, 0), max) / max) * 100) : 0;

  return (
    <div className="flex flex-col gap-1">
      <span id={labelId} className="text-sm text-ink-soft tabular-nums">
        {label}
      </span>
      <div
        role="progressbar"
        aria-labelledby={labelId}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-valuetext={label}
        className="h-2 w-full bg-rule"
      >
        <div className="h-full bg-ink-soft" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}
