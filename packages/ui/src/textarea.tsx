import type { TextareaHTMLAttributes } from "react";
import { forwardRef } from "react";

/**
 * Shared styling for the rounded card fields used across the settings screens.
 * Several pages used to inline this exact string, so any tweak had to be made
 * in every copy.
 */
export const fieldClassName =
  "w-full rounded-xl border border-black/10 bg-w px-4 py-3 text-sm t-primary outline-none transition-colors placeholder:text-neutral-400 focus:border-black/20 focus:ring-2 focus:ring-theme/10 disabled:cursor-not-allowed disabled:opacity-60 dark:border-white/10 dark:placeholder:text-neutral-500 dark:focus:border-white/20";

export const TextArea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea ref={ref} {...props} className={`${fieldClassName} ${className ?? ""}`} />
  ),
);

TextArea.displayName = "TextArea";
