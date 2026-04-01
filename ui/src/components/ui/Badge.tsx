import React from "react";

interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: "primary" | "success" | "warning" | "error" | "neutral";
}

export default function Badge({
  className = "",
  variant = "neutral",
  ...props
}: BadgeProps) {
  const variants = {
    primary: "bg-amber-500/10 text-amber-400 border border-amber-500/20",
    success: "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20",
    warning: "bg-yellow-500/10 text-yellow-400 border border-yellow-500/20",
    error: "bg-red-500/10 text-red-400 border border-red-500/20",
    neutral: "bg-zinc-800/50 text-zinc-400 border border-zinc-700/50",
  };

  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 text-xs font-mono rounded-sm border ${variants[variant]} ${className}`}
      {...props}
    />
  );
}
