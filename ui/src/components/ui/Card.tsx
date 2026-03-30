import React from "react"

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {}

export default function Card({ className = "", ...props }: CardProps) {
  return (
    <div className={`border rounded-lg bg-card ${className}`} {...props} />
  )
}

interface CardHeaderProps extends React.HTMLAttributes<HTMLDivElement> {}

export function CardHeader({ className = "", ...props }: CardHeaderProps) {
  return (
    <div className={`flex flex-col space-y-1.5 p-6 ${className}`} {...props} />
  )
}

interface CardTitleProps extends React.HTMLAttributes<HTMLHeadingElement> {}

export function CardTitle({ className = "", ...props }: CardTitleProps) {
  return <h3 className={`text-lg font-semibold ${className}`} {...props} />
}

interface CardContentProps extends React.HTMLAttributes<HTMLDivElement> {}

export function CardContent({ className = "", ...props }: CardContentProps) {
  return <div className={`p-6 pt-0 ${className}`} {...props} />
}
