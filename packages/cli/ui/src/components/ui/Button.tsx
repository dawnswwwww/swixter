import React from "react";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost" | "destructive";
  size?: "sm" | "md" | "lg";
}

export default function Button({
  className = "",
  variant = "secondary",
  size = "md",
  ...props
}: ButtonProps) {
  const baseClasses =
    "inline-flex items-center justify-center font-medium transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-50 disabled:cursor-not-allowed rounded font-sans";

  const variants = {
    primary: "bg-primary text-[#0c0c0e] hover:bg-primary/90 active:bg-primary/80",
    secondary:
      "bg-surface-elevated text-text-primary border border-borderStrong hover:bg-bg-hover",
    ghost: "text-text-secondary hover:text-text-primary hover:bg-bg-hover",
    destructive: "bg-destructive/10 text-destructive border border-destructive/20 hover:bg-destructive/20",
  };

  const sizes = {
    sm: "px-3 py-1.5 text-xs font-mono",
    md: "px-4 py-2 text-sm",
    lg: "px-6 py-2.5 text-base",
  };

  return (
    <button
      className={`${baseClasses} ${variants[variant]} ${sizes[size]} ${className}`}
      {...props}
    />
  );
}
