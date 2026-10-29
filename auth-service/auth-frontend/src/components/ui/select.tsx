import * as React from "react"
import { cn } from "@/lib/utils"

// Simple HTML-based select components (no radix-ui dependency needed)

interface SelectProps {
  value: string
  onValueChange: (value: string) => void
  disabled?: boolean
  children: React.ReactNode
}

interface SelectTriggerProps {
  className?: string
  children: React.ReactNode
  disabled?: boolean
}

interface SelectContentProps {
  children: React.ReactNode
  className?: string
}

interface SelectItemProps {
  value: string
  children: React.ReactNode
}

// Context to share state between compound components
const SelectContext = React.createContext<{
  value: string
  onValueChange: (value: string) => void
  open: boolean
  setOpen: (open: boolean) => void
  disabled?: boolean
}>({ value: '', onValueChange: () => {}, open: false, setOpen: () => {} })

function Select({ value, onValueChange, disabled, children }: SelectProps) {
  const [open, setOpen] = React.useState(false)
  return (
    <SelectContext.Provider value={{ value, onValueChange, open, setOpen, disabled }}>
      <div className="relative">{children}</div>
    </SelectContext.Provider>
  )
}

const SelectTrigger = React.forwardRef<HTMLButtonElement, SelectTriggerProps>(
  ({ className, children, disabled }, ref) => {
    const ctx = React.useContext(SelectContext)
    return (
      <button
        ref={ref}
        type="button"
        role="combobox"
        aria-expanded={ctx.open}
        disabled={disabled ?? ctx.disabled}
        onClick={() => ctx.setOpen(!ctx.open)}
        className={cn(
          "flex h-11 items-center gap-1.5 rounded-xl border border-input bg-transparent px-3 py-1 text-base shadow-xs transition-[color,box-shadow] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 dark:bg-input/30",
          className
        )}
      >
        {children}
        <svg
          width="12"
          height="12"
          viewBox="0 0 12 12"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="ml-auto opacity-50"
        >
          <path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
    )
  }
)
SelectTrigger.displayName = "SelectTrigger"

function SelectContent({ children, className }: SelectContentProps) {
  const ctx = React.useContext(SelectContext)
  const ref = React.useRef<HTMLDivElement>(null)

  React.useEffect(() => {
    if (!ctx.open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        ctx.setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [ctx.open])

  if (!ctx.open) return null

  return (
    <div
      ref={ref}
      className={cn(
        "absolute z-50 mt-1 max-h-64 w-full min-w-[8rem] overflow-auto rounded-xl border bg-popover p-1 text-popover-foreground shadow-md",
        className
      )}
    >
      {children}
    </div>
  )
}

function SelectItem({ value, children }: SelectItemProps) {
  const ctx = React.useContext(SelectContext)
  const selected = ctx.value === value

  return (
    <div
      role="option"
      aria-selected={selected}
      onClick={() => {
        ctx.onValueChange(value)
        ctx.setOpen(false)
      }}
      className={cn(
        "relative flex w-full cursor-default select-none items-center rounded-lg py-2 pl-3 pr-8 text-sm outline-none hover:bg-accent hover:text-accent-foreground",
        selected && "bg-accent text-accent-foreground"
      )}
    >
      {children}
      {selected && (
        <span className="absolute right-2 flex h-4 w-4 items-center justify-center">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M2.5 6L5 8.5L9.5 3.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      )}
    </div>
  )
}

// Keep these for API compatibility even though they're unused in our case
const SelectValue = ({ children }: { children?: React.ReactNode }) => <>{children}</>

export { Select, SelectTrigger, SelectContent, SelectItem, SelectValue }
