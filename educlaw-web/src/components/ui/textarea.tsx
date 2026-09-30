import * as React from "react"

import { cn } from "@/lib/utils"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex field-sizing-content min-h-20 w-full rounded-[8px] border border-input bg-card px-3 py-2 text-sm text-foreground outline-none transition-[border-color,box-shadow,background-color] duration-150 placeholder:text-muted-foreground focus-visible:border-primary/35 focus-visible:ring-[4px] focus-visible:ring-ring disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-100 aria-invalid:border-destructive aria-invalid:ring-[4px] aria-invalid:ring-[rgba(240,45,45,0.12)]",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
