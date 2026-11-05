import type { CSSProperties } from "react";
import { cn } from "@/lib/utils";

// The platform loader: a 5×5 dot matrix with a lit "snake" that runs down one column and up the next.
// Pure CSS (keyframes `dot-snake` in app/globals.css), so it animates in server-rendered loading screens
// before any JavaScript runs. It takes the text color, so it works on ink, paper and the signal tone.
// With reduced motion it holds still and shows the snake's shape instead.

const GRID = 5;
const TAIL = 8;
const STILL_HEAD = 12;

// The snake's route, as cell indexes in reading order: down column 1, up column 2, down column 3…
const PATH: number[] = [];
for (let column = 0; column < GRID; column += 1) {
  for (let step = 0; step < GRID; step += 1) {
    const row = column % 2 === 0 ? step : GRID - 1 - step;
    PATH.push(row * GRID + column);
  }
}
const STEP_OF_CELL = new Map(PATH.map((cell, step) => [cell, step]));

type DotLoaderProps = {
  /** Width and height in pixels. */
  size?: number;
  /** Seconds for one full lap of the snake. */
  cycle?: number;
  /** Announced to screen readers. Leave empty when the text next to the loader already says what is happening. */
  label?: string;
  className?: string;
};

export function DotLoader({ size = 20, cycle = 1.4, label, className }: DotLoaderProps) {
  const dot = Math.max(1.5, (size / GRID) * 0.62);
  return (
    <span
      role={label ? "status" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      className={cn("inline-grid shrink-0 grid-cols-5 grid-rows-5", className)}
      style={{ width: size, height: size }}
    >
      {Array.from({ length: GRID * GRID }, (_, cell) => {
        const step = STEP_OF_CELL.get(cell) ?? 0;
        const behind = (STILL_HEAD - step + PATH.length) % PATH.length;
        const still = behind < TAIL ? 1 - (behind / TAIL) * 0.85 : 0.12;
        return (
          <span
            key={cell}
            className="dot-loader-dot place-self-center rounded-full bg-current"
            style={
              {
                width: dot,
                height: dot,
                "--dot-cycle": `${cycle}s`,
                "--dot-delay": `${((step / PATH.length) - 1) * cycle}s`,
                "--dot-still": still,
              } as CSSProperties
            }
          />
        );
      })}
    </span>
  );
}
