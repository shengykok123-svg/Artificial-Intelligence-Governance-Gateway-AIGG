// A typeahead text input with a suggestions dropdown -- NOT a native
// <input list="..."> + <datalist>. That was tried first and turned out to
// behave like a closed dropdown in practice (browser-inconsistent), so
// typing a genuinely new value was blocked. This component never blocks
// typing -- it only ever overlays suggestions; whether a typed value has to
// match one of `options` is entirely the caller's business (see `disabled`
// gating in PolicyAndTools.tsx's two use sites: Detection Patterns allows
// any typed value to define a new class, Always Redact requires an exact
// match against an existing one).

import { useState } from "react";

export interface ComboboxProps {
  value: string;
  onChange: (value: string) => void;
  options: string[];
  placeholder?: string;
  className?: string;
}

export function Combobox({ value, onChange, options, placeholder, className }: ComboboxProps) {
  const [open, setOpen] = useState(false);
  const query = value.trim().toLowerCase();
  const matches = query
    ? options.filter((option) => option.toLowerCase().includes(query))
    : options;

  return (
    <div className="relative">
      <input
        value={value}
        onChange={(event) => { onChange(event.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 100)}
        placeholder={placeholder}
        autoComplete="off"
        className={className}
      />
      {open && matches.length > 0 && (
        <ul className="absolute z-10 mt-1 max-h-40 w-full overflow-auto rounded-md border border-slate-200 bg-white shadow-lg">
          {matches.map((option) => (
            <li key={option}>
              <button
                type="button"
                onMouseDown={(event) => { event.preventDefault(); onChange(option); setOpen(false); }}
                className="block w-full px-3 py-1.5 text-left text-sm hover:bg-emerald-50"
              >
                {option}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
