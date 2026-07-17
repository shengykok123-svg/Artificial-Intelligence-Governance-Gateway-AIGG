// M6  Empty + loading states for every screen. Required deliverable.
//
// SkeletonRows renders placeholder rows at the table's own column count, not
// a spinner over the whole page -- the layout must not jump every 3s when a
// poll lands on a projector.

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-gray-300 py-16 text-center">
      <p className="text-base font-medium text-gray-700">{title}</p>
      {hint && <p className="text-sm text-gray-500">{hint}</p>}
    </div>
  );
}

export function SkeletonRows({ rows = 5, columns = 4 }: { rows?: number; columns?: number }) {
  return (
    <>
      {Array.from({ length: rows }).map((_, r) => (
        <tr key={r} className="animate-pulse">
          {Array.from({ length: columns }).map((_, c) => (
            <td key={c} className="px-4 py-3">
              <div className="h-4 rounded bg-gray-200" style={{ width: `${60 + ((r + c) % 3) * 10}%` }} />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

export function ErrorState({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-6 text-center text-sm text-red-800">
      Could not load this. {message}
    </div>
  );
}
