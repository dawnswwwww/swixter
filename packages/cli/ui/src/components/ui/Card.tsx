import React from "react";

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: "default" | "elevated";
}

export default function Card({ className = "", variant = "default", ...props }: CardProps) {
  const variants = {
    default: "bg-surface border border-border",
    elevated: "bg-surface-elevated border border-borderStrong",
  };

  return (
    <div className={`${variants[variant]} ${className}`} {...props} />
  );
}

interface CardHeaderProps extends React.HTMLAttributes<HTMLDivElement> {}

export function CardHeader({ className = "", ...props }: CardHeaderProps) {
  return <div className={`px-5 py-4 border-b border-border ${className}`} {...props} />;
}

interface CardTitleProps extends React.HTMLAttributes<HTMLHeadingElement> {}

export function CardTitle({ className = "", ...props }: CardTitleProps) {
  return (
    <h3
      className={`font-mono font-semibold text-text-primary tracking-tight ${className}`}
      {...props}
    />
  );
}

interface CardContentProps extends React.HTMLAttributes<HTMLDivElement> {}

export function CardContent({ className = "", ...props }: CardContentProps) {
  return <div className={`p-5 ${className}`} {...props} />;
}
