import { Search, X } from "lucide-react";
import { useId } from "react";

interface SearchFieldProps {
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly placeholder?: string;
  readonly label?: string;
}

export function SearchField({
  value,
  onChange,
  placeholder = "Search",
  label = "Search",
}: SearchFieldProps) {
  const id = useId();
  return (
    <div className="fm-search" role="search">
      <Search size={13} strokeWidth={1.8} aria-hidden />
      <input
        id={id}
        type="search"
        className="fm-search__input"
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
        placeholder={placeholder}
        aria-label={label}
        autoComplete="off"
        spellCheck={false}
      />
      {value.length > 0 ? (
        <button
          type="button"
          className="fm-search__clear"
          onClick={() => onChange("")}
          aria-label="Clear search"
        >
          <X size={13} strokeWidth={2} aria-hidden />
        </button>
      ) : null}
    </div>
  );
}
