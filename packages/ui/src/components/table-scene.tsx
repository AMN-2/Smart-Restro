import * as React from "react"
import { cn } from "../lib/cn"

export type TableSceneState = "free" | "occupied" | "attention" | "active"

/**
 * The colour carries the state: the whole drawing is painted in
 * `currentColor`, so a table reads free / occupied / needs-attention from
 * across the room before its label does.
 */
const SCENE_TONE: Record<TableSceneState, string> = {
  free: "text-emerald-500",
  occupied: "text-amber-500",
  attention: "text-red-500",
  active: "text-primary",
}

export interface TableSceneProps {
  state?: TableSceneState
  className?: string
}

/**
 * A small isometric table with four chairs — the same drawing the waiter app
 * (urypos TableScene.vue) uses, so a table looks the same on every screen.
 * An occupied table is set with a plate. Decorative: the card's text
 * carries the state.
 */
export const TableScene = ({ state = "free", className }: TableSceneProps) => {
  // Gradient and filter ids must be unique per card; useId's colons are not
  // safe inside url(#…), so they are stripped.
  const uid = `ts${React.useId().replace(/[^a-zA-Z0-9]/g, "")}`

  return (
    <div
      aria-hidden="true"
      className={cn(
        "relative mx-auto w-full max-w-[11rem] drop-shadow-[0_8px_8px_rgba(56,40,30,0.09)]",
        SCENE_TONE[state],
        className
      )}
    >
      <svg
        viewBox="0 0 180 108"
        role="presentation"
        className="block h-auto w-full overflow-visible transition-transform duration-200 ease-out group-hover:-translate-y-0.5 group-hover:scale-[1.025]"
      >
        <defs>
          <linearGradient id={`top-${uid}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="currentColor" stopOpacity=".98" />
            <stop offset="1" stopColor="currentColor" stopOpacity=".72" />
          </linearGradient>
          <linearGradient id={`edge-${uid}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="currentColor" stopOpacity=".58" />
            <stop offset="1" stopColor="currentColor" stopOpacity=".88" />
          </linearGradient>
          <filter id={`blur-${uid}`} x="-40%" y="-80%" width="180%" height="260%">
            <feGaussianBlur stdDeviation="5" />
          </filter>
        </defs>
        <ellipse cx="90" cy="91" rx="55" ry="10" fill="currentColor" opacity=".13" filter={`url(#blur-${uid})`} />
        <g fill="currentColor">
          <path d="M23 44 41 35l14 8-18 10-14-9Z" opacity=".2" />
          <path d="m24 44 13 7v17l-8-4V52l-5-3v-5Z" opacity=".48" />
          <path d="m38 51 16-9v8l-11 6v12l-5 3V51Z" opacity=".72" />
          <path d="m125 43 17-9 15 8-18 10-14-9Z" opacity=".2" />
          <path d="m126 43 13 7v17l-8-4V51l-5-3v-5Z" opacity=".48" />
          <path d="m140 50 16-9v8l-11 6v12l-5 3V50Z" opacity=".72" />
          <path d="m43 78 17-9 15 8-18 10-14-9Z" opacity=".2" />
          <path d="m44 78 13 7v12l-8-4v-7l-5-3v-5Z" opacity=".48" />
          <path d="m58 85 16-9v8l-11 6v7l-5 3V85Z" opacity=".72" />
          <path d="m106 77 17-9 15 8-18 10-14-9Z" opacity=".2" />
          <path d="m107 77 13 7v12l-8-4v-7l-5-3v-5Z" opacity=".48" />
          <path d="m121 84 16-9v8l-11 6v7l-5 3V84Z" opacity=".72" />
        </g>
        <path d="m47 43 45-23 43 22-46 25-42-24Z" fill={`url(#top-${uid})`} />
        <path d="m47 43 42 24v12L47 55V43Z" fill={`url(#edge-${uid})`} />
        <path d="m89 67 46-25v12L89 79V67Z" fill="currentColor" opacity=".84" />
        <path d="m55 42 37-18 34 17-37 20-34-19Z" fill="white" opacity=".13" />
        <path d="m62 58 8 5v22l-6-3-2-24ZM113 56l8-4v22l-6 3-2-21Z" fill="currentColor" opacity=".72" />
        {state !== "free" && (
          <g className="origin-center animate-scale-in [transform-box:fill-box]">
            <ellipse cx="89" cy="44" rx="12" ry="6.5" fill="white" opacity=".9" />
            <ellipse cx="89" cy="43" rx="7" ry="3.5" fill="currentColor" opacity=".22" />
            <path d="m72 48 5-3 5 3-5 3-5-3Zm23-14 5-3 5 3-5 3-5-3Z" fill="white" opacity=".78" />
          </g>
        )}
      </svg>
    </div>
  )
}
