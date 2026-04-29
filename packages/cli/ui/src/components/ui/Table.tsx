import React from "react"

interface TableProps extends React.TableHTMLAttributes<HTMLTableElement> {}

export default function Table({ className = "", ...props }: TableProps) {
  return <table className={`w-full ${className}`} {...props} />
}

interface TableHeaderProps extends React.HTMLAttributes<HTMLTableSectionElement> {}

export function TableHeader({ className = "", ...props }: TableHeaderProps) {
  return <thead className={`border-b bg-muted/50 ${className}`} {...props} />
}

interface TableBodyProps extends React.HTMLAttributes<HTMLTableSectionElement> {}

export function TableBody({ className = "", ...props }: TableBodyProps) {
  return <tbody className={className} {...props} />
}

interface TableRowProps extends React.HTMLAttributes<HTMLTableRowElement> {}

export function TableRow({ className = "", ...props }: TableRowProps) {
  return <tr className={`border-b hover:bg-muted/30 ${className}`} {...props} />
}

interface TableHeadProps extends React.HTMLAttributes<HTMLTableCellElement> {}

export function TableHead({ className = "", ...props }: TableHeadProps) {
  return <th className={`px-6 py-3 text-left text-sm font-medium ${className}`} {...props} />
}

interface TableCellProps extends React.HTMLAttributes<HTMLTableCellElement> {}

export function TableCell({ className = "", ...props }: TableCellProps) {
  return <td className={`px-6 py-4 text-sm ${className}`} {...props} />
}
