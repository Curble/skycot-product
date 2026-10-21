import type { LucideIcon } from "lucide-react";
import type { ButtonHTMLAttributes, ReactNode } from "react";

export type ButtonVariant = "primary" | "secondary" | "destructive" | "plain" | "quiet";
export type ButtonSize = "sm" | "md" | "lg";

interface ButtonBaseProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className"> {
  readonly variant?: ButtonVariant;
  readonly size?: ButtonSize;
  /** Destructive buttons are outlined by default; `filled` paints them red. */
  readonly filled?: boolean;
  readonly block?: boolean;
  readonly icon?: LucideIcon;
  readonly children?: ReactNode;
}

const variantClass: Record<ButtonVariant, string> = {
  primary: "fm-btn--primary",
  secondary: "",
  destructive: "fm-btn--destructive",
  plain: "fm-btn--plain",
  quiet: "fm-btn--quiet",
};

const sizeClass: Record<ButtonSize, string> = { sm: "fm-btn--sm", md: "", lg: "fm-btn--lg" };
const iconSize: Record<ButtonSize, number> = { sm: 12, md: 14, lg: 16 };

export function Button({
  variant = "secondary",
  size = "md",
  filled = false,
  block = false,
  icon: Icon,
  type = "button",
  children,
  ...rest
}: ButtonBaseProps) {
  const classes = [
    "fm-btn",
    variantClass[variant],
    sizeClass[size],
    filled ? "fm-btn--filled" : "",
    block ? "fm-btn--block" : "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <button type={type} className={classes} {...rest}>
      {Icon ? <Icon size={iconSize[size]} strokeWidth={1.8} aria-hidden /> : null}
      {children}
    </button>
  );
}

interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className"> {
  readonly icon: LucideIcon;
  /** Required: the icon alone is not a label. */
  readonly label: string;
  readonly size?: ButtonSize;
  readonly tone?: "default" | "destructive";
}

const iconButtonGlyph: Record<ButtonSize, number> = { sm: 14, md: 17, lg: 20 };

export function IconButton({
  icon: Icon,
  label,
  size = "md",
  tone = "default",
  type = "button",
  ...rest
}: IconButtonProps) {
  const classes = [
    "fm-btn",
    "fm-btn--icon",
    sizeClass[size],
    tone === "destructive" ? "fm-btn--destructive" : "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <button type={type} className={classes} aria-label={label} {...rest}>
      <Icon size={iconButtonGlyph[size]} strokeWidth={1.7} aria-hidden />
    </button>
  );
}
