import type { TextareaHTMLAttributes } from "react";
import { forwardRef } from "react";
import { fieldClassName } from "./field-styles";

export const TextArea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea ref={ref} {...props} className={`${fieldClassName} ${className ?? ""}`} />
  ),
);

TextArea.displayName = "TextArea";
