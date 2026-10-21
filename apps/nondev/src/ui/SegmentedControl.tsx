import { useId, type KeyboardEvent, type ReactNode } from "react";

export interface SegmentedOption<T extends string> {
  readonly value: T;
  readonly label: ReactNode;
  /** Small tag after the label, e.g. "Default" or "Riskier". */
  readonly tag?: { readonly text: string; readonly tone?: "neutral" | "warn" };
  readonly disabled?: boolean;
}

interface SegmentedControlProps<T extends string> {
  readonly options: ReadonlyArray<SegmentedOption<T>>;
  readonly value: T;
  readonly onChange: (value: T) => void;
  readonly label: string;
  readonly size?: "sm" | "md";
  readonly block?: boolean;
  readonly disabled?: boolean;
}

/** Radiogroup semantics with arrow-key movement, as the macOS control behaves. */
export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  label,
  size = "md",
  block = false,
  disabled = false,
}: SegmentedControlProps<T>) {
  const id = useId();
  const classes = ["fm-seg", size === "sm" ? "fm-seg--sm" : "", block ? "fm-seg--block" : ""]
    .filter(Boolean)
    .join(" ");

  const move = (event: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    const delta =
      event.key === "ArrowRight" || event.key === "ArrowDown"
        ? 1
        : event.key === "ArrowLeft" || event.key === "ArrowUp"
          ? -1
          : 0;
    if (delta === 0) return;
    event.preventDefault();
    const enabled = options.filter((option) => !option.disabled);
    const index = enabled.findIndex((option) => option.value === value);
    const next = enabled[(index + delta + enabled.length) % enabled.length];
    if (next) {
      onChange(next.value);
      const target = event.currentTarget.querySelector<HTMLButtonElement>(
        `[data-value="${next.value}"]`,
      );
      target?.focus();
    }
  };

  return (
    <div role="radiogroup" aria-label={label} className={classes} onKeyDown={move} id={id}>
      {options.map((option) => {
        const checked = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            data-value={option.value}
            className="fm-seg__option"
            disabled={disabled || option.disabled}
            onClick={() => onChange(option.value)}
          >
            {option.label}
            {option.tag ? (
              <span
                className={`fm-seg__tag${option.tag.tone === "warn" ? " fm-seg__tag--warn" : ""}`}
              >
                {option.tag.text}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
