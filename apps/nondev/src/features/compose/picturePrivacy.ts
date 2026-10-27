/** The picture stays here until the child sends it to the family's chosen assistant. */
export function picturePrivacyNotice(provider: string | null): string {
  if (provider === null) {
    return "Your picture stays on this Mac until you send it. Then it goes only to the AI assistant your grown-up chose.";
  }
  return `Your picture stays on this Mac until you send it. Then it goes only to ${provider}, the AI assistant your grown-up chose.`;
}
