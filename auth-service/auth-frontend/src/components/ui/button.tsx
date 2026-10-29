import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { Slot } from "radix-ui"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-xl text-sm font-medium whitespace-nowrap transition-[transform,box-shadow,background-color,border-color,color] duration-200 outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-0 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 active:scale-[0.98]",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground shadow-[0_18px_36px_-22px_oklch(0.44_0.12_249_/_0.55)] hover:-translate-y-0.5 hover:bg-primary/92",
        destructive:
          "bg-destructive text-white shadow-[0_18px_36px_-22px_oklch(0.59_0.21_27_/_0.45)] hover:-translate-y-0.5 hover:bg-destructive/92 focus-visible:ring-destructive/20 dark:bg-destructive/60 dark:focus-visible:ring-destructive/40",
        outline:
          "border border-white/50 bg-white/60 shadow-[inset_0_1px_0_oklch(1_0_0_/_0.8)] backdrop-blur-sm hover:-translate-y-0.5 hover:bg-white/80 hover:text-accent-foreground dark:border-input/70 dark:bg-input/40 dark:hover:bg-input/60",
        secondary:
          "bg-secondary text-secondary-foreground shadow-[inset_0_1px_0_oklch(1_0_0_/_0.5)] hover:-translate-y-0.5 hover:bg-secondary/84",
        ghost:
          "hover:-translate-y-0.5 hover:bg-accent/80 hover:text-accent-foreground dark:hover:bg-accent/70",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-4 py-2 has-[>svg]:px-3",
        sm: "h-8 gap-1.5 rounded-md px-3 has-[>svg]:px-2.5",
        lg: "h-10 rounded-md px-6 has-[>svg]:px-4",
        icon: "size-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
