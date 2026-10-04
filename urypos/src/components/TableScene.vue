<template>
  <div class="table-scene" :class="stateClass" aria-hidden="true">
    <svg viewBox="0 0 180 108" role="presentation">
      <defs>
        <linearGradient :id="`top-${uid}`" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="currentColor" stop-opacity=".98" /><stop offset="1" stop-color="currentColor" stop-opacity=".72" /></linearGradient>
        <linearGradient :id="`edge-${uid}`" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="currentColor" stop-opacity=".58" /><stop offset="1" stop-color="currentColor" stop-opacity=".88" /></linearGradient>
        <filter :id="`blur-${uid}`" x="-40%" y="-80%" width="180%" height="260%"><feGaussianBlur stdDeviation="5" /></filter>
      </defs>
      <ellipse cx="90" cy="91" rx="55" ry="10" fill="currentColor" opacity=".13" :filter="`url(#blur-${uid})`" />
      <g fill="currentColor">
        <path d="M23 44 41 35l14 8-18 10-14-9Z" opacity=".2" /><path d="m24 44 13 7v17l-8-4V52l-5-3v-5Z" opacity=".48" /><path d="m38 51 16-9v8l-11 6v12l-5 3V51Z" opacity=".72" />
        <path d="m125 43 17-9 15 8-18 10-14-9Z" opacity=".2" /><path d="m126 43 13 7v17l-8-4V51l-5-3v-5Z" opacity=".48" /><path d="m140 50 16-9v8l-11 6v12l-5 3V50Z" opacity=".72" />
        <path d="m43 78 17-9 15 8-18 10-14-9Z" opacity=".2" /><path d="m44 78 13 7v12l-8-4v-7l-5-3v-5Z" opacity=".48" /><path d="m58 85 16-9v8l-11 6v7l-5 3V85Z" opacity=".72" />
        <path d="m106 77 17-9 15 8-18 10-14-9Z" opacity=".2" /><path d="m107 77 13 7v12l-8-4v-7l-5-3v-5Z" opacity=".48" /><path d="m121 84 16-9v8l-11 6v7l-5 3V84Z" opacity=".72" />
      </g>
      <path d="m47 43 45-23 43 22-46 25-42-24Z" :fill="`url(#top-${uid})`" /><path d="m47 43 42 24v12L47 55V43Z" :fill="`url(#edge-${uid})`" /><path d="m89 67 46-25v12L89 79V67Z" fill="currentColor" opacity=".84" /><path d="m55 42 37-18 34 17-37 20-34-19Z" fill="white" opacity=".13" /><path d="m62 58 8 5v22l-6-3-2-24ZM113 56l8-4v22l-6 3-2-21Z" fill="currentColor" opacity=".72" />
      <g v-if="state !== 'free'" class="table-scene-service"><ellipse cx="89" cy="44" rx="12" ry="6.5" fill="white" opacity=".9" /><ellipse cx="89" cy="43" rx="7" ry="3.5" fill="currentColor" opacity=".22" /><path d="m72 48 5-3 5 3-5 3-5-3Zm23-14 5-3 5 3-5 3-5-3Z" fill="white" opacity=".78" /></g>
    </svg>
  </div>
</template>

<script>
let sceneId = 0;
export default {
  name: "TableScene",
  props: { state: { type: String, default: "free" } },
  computed: {
    /**
     * Spelled out in full: Tailwind keeps a class in @layer components only
     * when it finds the literal name, and a built `table-scene-${state}` was
     * stripped from the build, so every table drew green whatever its state.
     */
    stateClass() {
      return {
        free: "",
        active: "table-scene-active",
        occupied: "table-scene-occupied",
        attention: "table-scene-attention",
      }[this.state] || "";
    },
  },
  data() { sceneId += 1; return { uid: `table-scene-${sceneId}` }; },
};
</script>
