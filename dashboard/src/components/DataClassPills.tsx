// M6  Data classes as pills.

export function DataClassPills({ dataClasses }: { dataClasses: string[] }) {
  if (dataClasses.length === 0) {
    return <span className="text-sm text-gray-400">—</span>;
  }
  return (
    <div className="flex flex-wrap gap-1">
      {dataClasses.map((dc) => (
        <span
          key={dc}
          className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700"
        >
          {dc}
        </span>
      ))}
    </div>
  );
}
