import { useId, type InputHTMLAttributes } from "react";

interface TextFieldProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "className" | "id" | "size"
> {
  readonly label: string;
  /** Hide the visible label and expose it to assistive tech only. */
  readonly hideLabel?: boolean;
  readonly mono?: boolean;
}

export function TextField({ label, hideLabel = false, mono = false, ...rest }: TextFieldProps) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className={hideLabel ? "fm-sr-only" : "fm-field-label"}>
        {label}
      </label>
      <input id={id} className={`fm-field${mono ? " fm-field--mono" : ""}`} {...rest} />
    </div>
  );
}
