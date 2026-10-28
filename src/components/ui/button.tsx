import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap text-sm font-heading cursor-pointer transition-[background-color,color,border-color,box-shadow] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 disabled:cursor-not-allowed [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground min-h-[44px] hover:bg-primary/90 active:bg-primary/80 shadow-[0_0_0_0_rgba(124,58,237,0)] hover:shadow-[0_0_20px_rgba(124,58,237,0.25)]",
        destructive:
          "bg-[#2A1220] text-[#EF4444] min-h-[44px] border border-[#8A2F42] hover:bg-[#EF4444]/10 active:bg-[#EF4444]/20",
        outline:
          "border border-input bg-transparent text-foreground min-h-[44px] hover:bg-accent hover:text-foreground active:bg-accent",
        secondary:
          "border border-border bg-card text-foreground min-h-[44px] hover:bg-accent hover:text-foreground active:bg-accent",
        ghost: "text-foreground hover:bg-accent active:bg-accent",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-11 px-6 py-2 rounded-lg",
        sm: "h-9 px-4 text-xs rounded-lg",
        lg: "h-12 px-8 rounded-lg",
        icon: "h-11 w-11 rounded-lg",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
