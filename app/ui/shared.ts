/** Shared Tailwind class strings for the app's visual skin — used by the
 *  main stage flow (app/page.tsx) and by /login, /vocab. */

export const btnPrimary =
  "w-full rounded-[8px] bg-accent hover:bg-accent-deep py-4 text-sm font-semibold text-white transition-[background-color,box-shadow,transform] duration-150 disabled:opacity-25 disabled:shadow-none disabled:translate-x-0 disabled:translate-y-0 shadow-[5px_6px_0_0_#000] hover:shadow-[3px_4px_0_0_#000] hover:translate-x-[2px] hover:translate-y-[2px] active:shadow-[1px_2px_0_0_#000] active:translate-x-[4px] active:translate-y-[4px]";

export const btnGhost =
  "rounded-[10px] border border-rim bg-surface px-4 py-2.5 text-sm font-medium text-ink hover:border-primary/40 hover:bg-primary-light/40 transition-colors";

export const sectionLabel = "text-[11px] font-semibold text-muted uppercase tracking-widest";

export const fieldClass =
  "w-full rounded-[8px] border border-rim bg-surface px-3.5 py-2.5 text-sm text-ink placeholder:text-muted/70 focus:outline-none focus:border-primary/50 transition-colors";
