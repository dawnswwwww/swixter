import React from "react"

interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: "default" | "primary" | "success" | "warning"
}

export default function Badge({
  className = "",
  variant = "default",
  ...props
}: BadgeProps) {
  const variants = {
    default: "px-2 py-1 rounded-full bg-muted text-muted-foreground text-xs",
    primary: "px-2 py-1 rounded-full bg-primary/10 text-primary text-xs",
    success: "px-2 py-1 rounded-full bg-green-500/10 text-green-500 text-xs",
    warning: "px-2 py-1 rounded-full bg-yellow-500/10 text-yellow-500 text-xs",
  }

  return <span className={`${variants[variant]} ${className}`} {...props} />
}
