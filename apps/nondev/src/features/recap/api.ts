// The recap over HTTP. The engine answers only after a grown-up's "yes" (the parent code, for
// "recap", or the Family settings' own); a refusal asks for the code here and tries once more.
import type { FamilyResult } from "../family/api";
import { request } from "../family/api";
import { parseRecap, type RecapRange, type RecapReport } from "./recap";

export function fetchRecap(childId: string, range: RecapRange): Promise<FamilyResult<RecapReport>> {
  const query = new URLSearchParams({ childId, range });
  return request("GET", `/recap?${query.toString()}`, undefined, parseRecap);
}

/** The composer's shield card showed: the kinds of detail only, for the recap. */
export function reportShieldCatch(categories: ReadonlyArray<string>): void {
  if (categories.length === 0) return;
  void request("POST", "/shield-caught", { categories }, () => true);
}
