import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import { Loader2 } from "lucide-react";

/**
 * Button — see spec §3.3.
 * Variants: primary | secondary | ghost | destructive
 * Sizes:    xs | sm | md | lg | xl  (control-size tokens)
 */
const buttonVariants = cva(
  [
    "relative inline-flex items-center justify-center gap-1.5 select-none whitespace-nowrap",
    "rounded-sm font-sans font-medium",
    "transition-colors duration-fast ease-out",
    "focus-visible:outline-none focus-visible:shadow-focus",
    "disabled:cursor-not-allowed",
    "[&_svg]:shrink-0 [&_svg]:pointer-events-none",
  ],
  {
    variants: {
      variant: {
        primary: [
          "bg-accent text-text-on-accent",
          "hover:bg-accent-hover",
          "active:bg-accent-active",
          "disabled:bg-accent disabled:opacity-disabled",
        ],
        secondary: [
          "bg-surface-2 text-text-primary",
          "hover:bg-surface-3",
          "active:bg-surface-1",
          "border border-border-subtle",
          "disabled:opacity-disabled",
        ],
        ghost: [
          "bg-transparent text-text-secondary",
          "hover:bg-surface-2 hover:text-text-primary",
          "active:bg-surface-1",
          "disabled:opacity-disabled",
        ],
        destructive: [
          "bg-danger text-text-on-danger",
          "hover:bg-danger-hover",
          "active:bg-danger",
          "disabled:opacity-disabled",
        ],
      },
      size: {
        xs: "h-ctrl-xs px-1.5 text-mono-xs gap-1 [&_svg]:size-3",
        sm: "h-ctrl-sm px-2 text-caption [&_svg]:size-3.5",
        md: "h-ctrl-md px-3 text-body [&_svg]:size-4",
        lg: "h-ctrl-lg px-3.5 text-body-strong [&_svg]:size-4",
        xl: "h-ctrl-xl px-[18px] text-h3 [&_svg]:size-5",
      },
      iconOnly: {
        true: "px-0 aspect-square",
        false: "",
      },
    },
    defaultVariants: { variant: "secondary", size: "md", iconOnly: false },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  loading?: boolean;
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    {
      className,
      variant,
      size,
      iconOnly,
      asChild = false,
      loading,
      disabled,
      children,
      ...props
    },
    ref,
  ) {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp
        ref={ref}
        className={cn(buttonVariants({ variant, size, iconOnly }), className)}
        disabled={disabled || loading}
        aria-busy={loading || undefined}
        {...props}
      >
        {loading ? (
          <Loader2 className="animate-spin" aria-hidden />
        ) : (
          children
        )}
      </Comp>
    );
  },
);
