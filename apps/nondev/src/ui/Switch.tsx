interface SwitchProps {
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
  readonly label: string;
  readonly disabled?: boolean;
  /** ID of the visible text that names this switch, when there is one. */
  readonly labelledBy?: string;
}

export function Switch({ checked, onChange, label, disabled = false, labelledBy }: SwitchProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={labelledBy ? undefined : label}
      aria-labelledby={labelledBy}
      className="fm-switch"
      disabled={disabled}
      onClick={() => onChange(!checked)}
    >
      <span className="fm-switch__knob" aria-hidden />
    </button>
  );
}
