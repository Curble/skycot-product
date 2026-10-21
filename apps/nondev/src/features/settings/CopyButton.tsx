import { Check, Copy } from "lucide-react";
import { useEffect, useState } from "react";

import { Button, type ButtonSize } from "../../ui/Button";

/** "Copy the command" → "Copied" for two seconds. Falls back to selecting nothing silently. */
export function CopyButton({
  text,
  label = "Copy the command",
  size = "sm",
}: {
  readonly text: string;
  readonly label?: string;
  readonly size?: ButtonSize;
}) {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(timer);
  }, [copied]);
  return (
    <Button
      size={size}
      icon={copied ? Check : Copy}
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(
          () => setCopied(true),
          () => undefined,
        );
      }}
    >
      {copied ? "Copied" : label}
    </Button>
  );
}
