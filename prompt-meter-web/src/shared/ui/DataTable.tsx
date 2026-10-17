import type { ReactNode } from "react";

export type Column<T> = { key: string; header: ReactNode; render: (row: T) => ReactNode };

export function DataTable<T>({ columns, rows }: { columns: Column<T>[]; rows: T[] }) {
  return (
    <div className="table-shell">
      <table>
        <thead>
          <tr>{columns.map((column) => <th key={column.key}>{column.header}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={String((row as Record<string, unknown>).itemId ?? (row as Record<string, unknown>).id ?? index)}>
              {columns.map((column) => <td key={column.key}>{column.render(row)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
