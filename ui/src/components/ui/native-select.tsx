import { ChevronDown } from "lucide-react"
import * as React from "react"
import { cn } from "@/lib/utils"

function NativeSelect({ className, children, ...props }: React.ComponentProps<"select">) {
  return (
    <div className={cn("relative inline-block", className)}>
      <select
        className="h-9 w-full appearance-none rounded-lg border border-input bg-transparent pr-9 pl-2.5 text-sm outline-none transition-colors focus-visible:border-ring disabled:opacity-50"
        {...props}
      >
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-muted-foreground" />
    </div>
  )
}

export { NativeSelect }
