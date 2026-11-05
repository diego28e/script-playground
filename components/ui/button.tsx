import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"
import { PendingFace } from "@/components/ui/pending"

const buttonVariants = cva(
    "relative inline-flex items-center justify-center whitespace-nowrap rounded-full text-sm font-semibold ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 cursor-pointer",
    {
        variants: {
            variant: {
                // Pills with a lifted shadow, matching ShimmerButton (components/ui/shimmer-button.tsx).
                default: "bg-primary text-primary-foreground shadow-[var(--shadow-tile)] hover:bg-primary/90",
                destructive:
                    "bg-destructive text-destructive-foreground shadow-[var(--shadow-tile)] hover:bg-destructive/90",
                outline:
                    "border border-border bg-card shadow-[var(--shadow-tile)] hover:bg-accent hover:text-accent-foreground",
                secondary:
                    "bg-secondary text-secondary-foreground hover:bg-secondary/80",
                ghost: "hover:bg-accent hover:text-accent-foreground",
                link: "text-foreground underline-offset-4 hover:underline",
            },
            size: {
                default: "h-10 px-5 py-2",
                sm: "h-9 px-4",
                lg: "h-11 px-8",
                icon: "h-10 w-10",
            },
        },
        defaultVariants: {
            variant: "default",
            size: "default",
        },
    }
)

export interface ButtonProps
    extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
    asChild?: boolean
    /** Busy: the label gives way to the DotLoader, the button keeps its size and ignores further clicks. */
    loading?: boolean
    /** Shown next to the loader while busy, e.g. "Saving…". */
    loadingLabel?: React.ReactNode
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
    ({ className, variant, size, asChild = false, loading, loadingLabel, disabled, children, ...props }, ref) => {
        const Comp = asChild ? Slot : "button"
        // Only buttons that can be busy get the pending wrapper, so every other button renders as before.
        const canBeBusy = loading !== undefined && !asChild
        return (
            <Comp
                // Busy is not "unavailable": keep full opacity while the native disabled blocks repeat clicks.
                className={cn(buttonVariants({ variant, size, className }), loading && "disabled:opacity-100")}
                ref={ref}
                disabled={disabled || loading}
                aria-busy={loading || undefined}
                {...props}
            >
                {canBeBusy ? (
                    <PendingFace pending={loading} label={loadingLabel}>
                        {children}
                    </PendingFace>
                ) : (
                    children
                )}
            </Comp>
        )
    }
)
Button.displayName = "Button"

export { Button, buttonVariants }
