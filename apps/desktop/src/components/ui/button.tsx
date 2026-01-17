import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"
import * as React from "react"
import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-all disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 shrink-0 [&_svg]:shrink-0 outline-none focus-visible:ring-0 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
  {
    variants: {
      variant: {
        default:
          "[.theme-classic_&]:bg-transparent [.theme-classic_&]:border [.theme-classic_&]:border-black [.theme-classic_&]:text-black [.theme-classic_&]:hover:bg-black/5 [.theme-inverted_&]:bg-black [.theme-inverted_&]:text-white [.theme-inverted_&]:hover:bg-black/90 shadow-xs",
        destructive:
          "[.theme-classic_&]:bg-red-600 [.theme-classic_&]:border [.theme-classic_&]:border-red-600 [.theme-classic_&]:text-white [.theme-classic_&]:hover:bg-red-700 [.theme-classic_&]:hover:border-red-700 [.theme-inverted_&]:bg-red-600 [.theme-inverted_&]:text-white [.theme-inverted_&]:hover:bg-red-700 shadow-xs focus-visible:ring-red-500/20",
        outline:
          "[.theme-classic_&]:border [.theme-classic_&]:border-black [.theme-classic_&]:bg-transparent [.theme-classic_&]:hover:bg-black/5 [.theme-inverted_&]:bg-black [.theme-inverted_&]:text-white [.theme-inverted_&]:hover:bg-black/90 shadow-xs",
        secondary:
          "[.theme-classic_&]:bg-transparent [.theme-classic_&]:border [.theme-classic_&]:border-black [.theme-classic_&]:text-secondary-foreground [.theme-classic_&]:hover:bg-black/5 [.theme-inverted_&]:bg-gray-200 [.theme-inverted_&]:text-gray-900 [.theme-inverted_&]:hover:bg-gray-300 shadow-xs",
        ghost:
          "[.theme-classic_&]:bg-transparent [.theme-classic_&]:hover:bg-black/5 [.theme-inverted_&]:bg-black [.theme-inverted_&]:text-white [.theme-inverted_&]:hover:bg-black/90 shadow-xs",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-4 py-2 has-[>svg]:px-3",
        sm: "h-8 rounded-md gap-1.5 px-3 has-[>svg]:px-2.5",
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
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot : "button"

  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
