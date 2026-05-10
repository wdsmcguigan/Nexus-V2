import * as React from "react";
import { cn } from "@/lib/utils";

/** Input — see spec §3.4. */
export interface InputProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, "size"> {
  size?: "sm" | "md" | "lg";
  invalid?: boolean;
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  function Input({ className, size = "md", invalid, ...props }, ref) {
    return (
      <input
        ref={ref}
        aria-invalid={invalid || undefined}
        className={cn(
          "w-full rounded-sm bg-surface-2 px-2.5 font-sans text-body text-text-primary",
          "border border-border-default",
          "placeholder:text-text-muted",
          "transition-colors duration-fast ease-out",
          "hover:border-border-strong",
          "focus:outline-none focus:border-accent focus:shadow-focus",
          "disabled:opacity-disabled disabled:cursor-not-allowed",
          size === "sm" && "h-ctrl-md text-small",
          size === "md" && "h-ctrl-lg",
          size === "lg" && "h-ctrl-xl text-h3",
          invalid && "border-danger focus:border-danger focus:shadow-focus-danger",
          className,
        )}
        {...props}
      />
    );
  },
);
