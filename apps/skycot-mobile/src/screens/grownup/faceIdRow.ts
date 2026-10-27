// nondev-seam: skycot-iphone-q45-face-id-row
export function faceIdRowAction(
  available: boolean,
  everywhere: boolean,
): "settings" | "set-up" | null {
  if (!available) return "settings";
  return everywhere ? null : "set-up";
}

export function faceIdRowSubtitle(input: {
  readonly label: string;
  readonly available: boolean;
  readonly everywhere: boolean;
}): string {
  if (input.everywhere) return "Allow once asks for it each time, for that one request.";
  if (!input.available)
    return `Turn on ${input.label} in Settings to use it here. Parent code still works.`;
  return "Set it up once with the parent code.";
}
