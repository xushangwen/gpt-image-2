import { type ButtonHTMLAttributes } from "react";

export type ButtonVariant =
  | "primary"       // .ck-primary-btn   — orange CTA
  | "secondary"     // .ck-btn.action-btn — neutral filled + flex
  | "icon"          // .ck-btn.ck-icon-btn — square icon
  | "ghost"         // .ghost-btn         — transparent text action
  | "overlay"       // .overlay-btn       — image card hover buttons
  | "lightbox"      // .lightbox-btn-action — lightbox top-right
  | "lightbox-nav"; // .lightbox-nav      — prev/next navigation

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary:        "ck-primary-btn",
  secondary:      "ck-btn action-btn",
  icon:           "ck-btn ck-icon-btn",
  ghost:          "ghost-btn",
  overlay:        "overlay-btn",
  lightbox:       "lightbox-btn-action",
  "lightbox-nav": "lightbox-nav",
};

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  /** Automatically sets disabled=true when true */
  loading?: boolean;
}

export default function Button({
  variant = "secondary",
  loading,
  disabled,
  className,
  children,
  ...rest
}: Props) {
  const base = VARIANT_CLASS[variant];
  const cls = [base, className].filter(Boolean).join(" ");

  return (
    <button {...rest} className={cls} disabled={disabled || loading}>
      {children}
    </button>
  );
}
