import { Toaster as Sonner, type ToasterProps } from "sonner"
import { CircleCheckIcon, InfoIcon, TriangleAlertIcon, OctagonXIcon, Loader2Icon } from "lucide-react"

const Toaster = ({ ...props }: ToasterProps) => {
  return (
    <Sonner
      theme="light"
      position="top-right"
      className="toaster group"
      icons={{
        success: (
          <CircleCheckIcon className="size-4" />
        ),
        info: (
          <InfoIcon className="size-4" />
        ),
        warning: (
          <TriangleAlertIcon className="size-4" />
        ),
        error: (
          <OctagonXIcon className="size-4" />
        ),
        loading: (
          <Loader2Icon className="size-4 animate-spin" />
        ),
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: "cn-toast !border !items-start !gap-3 !p-4",
          title: "!font-semibold",
          description: "!text-current !opacity-80",
          success: "!border-green-600 !bg-green-50 !text-green-900 [&_[data-icon]]:!text-green-600",
          error: "!border-red-600 !bg-red-50 !text-red-900 [&_[data-icon]]:!text-red-600",
          warning: "!border-amber-600 !bg-amber-50 !text-amber-900 [&_[data-icon]]:!text-amber-600",
          info: "!border-blue-600 !bg-blue-50 !text-blue-900 [&_[data-icon]]:!text-blue-600",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
