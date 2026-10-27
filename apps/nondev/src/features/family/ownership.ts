import { HOME_HREF, navigate } from "../../router";
import { showToast } from "../../ui/Toast";

export const NOT_THEIRS_MESSAGE = "That's not yours to open.";

export function isNotTheirsMessage(message: string | null | undefined): boolean {
  return message?.includes(NOT_THEIRS_MESSAGE) === true;
}

export function returnHomeFromOwnershipRefusal(message: string): void {
  showToast(isNotTheirsMessage(message) ? NOT_THEIRS_MESSAGE : message);
  navigate(HOME_HREF);
}
