/**
 * Shared styling for the rounded card fields used across the settings screens.
 *
 * Every page used to inline (a variation of) this string, so a tweak had to be
 * applied in each copy and the copies drifted apart. The base carries
 * everything except the padding, text size and placeholder/disabled styling,
 * which is what the individual variants decide.
 */
export const fieldBaseClassName =
  "w-full rounded-xl border border-black/10 bg-w t-primary outline-none transition-colors focus:border-black/20 focus:ring-2 focus:ring-theme/10 dark:border-white/10 dark:focus:border-white/20";

/** Default field: comfortable padding, placeholder and disabled styling. */
export const fieldClassName = `${fieldBaseClassName} px-4 py-3 text-sm placeholder:text-neutral-400 disabled:cursor-not-allowed disabled:opacity-60 dark:placeholder:text-neutral-500`;

/** Denser field, for rows where several inputs sit next to each other. */
export const fieldCompactClassName = `${fieldBaseClassName} px-4 py-2.5 text-sm`;

/** Tightest field, for inputs inside a popover such as the date/time picker. */
export const fieldTightClassName = `${fieldBaseClassName} px-3 py-2 text-sm`;
