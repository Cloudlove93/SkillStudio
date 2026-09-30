import * as React from "react"

import { cn } from "@/lib/utils"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <input
      type={type}
      data-slot="input"
      className={cn(
        "h-10 w-full min-w-0 rounded-[8px] border border-input bg-card px-3 py-2 text-sm text-foreground outline-none transition-[border-color,box-shadow,background-color] duration-150 selection:bg-primary selection:text-primary-foreground placeholder:text-muted-foreground file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground",
        "focus-visible:border-primary/35 focus-visible:ring-[4px] focus-visible:ring-ring",
        "aria-invalid:border-destructive aria-invalid:ring-[4px] aria-invalid:ring-[rgba(240,45,45,0.12)]",
        className
      )}
      {...props}
    />
  )
}

export { Input }
