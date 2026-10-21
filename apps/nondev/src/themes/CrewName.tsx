// Inline "Sam" / "Crew" for JSX copy inside components that have no other
// reason to call useCrew themselves.
import { useCrew } from "./useCrew";

export function CrewName({ role = "builder" }: { readonly role?: "builder" | "checker" }) {
  const crew = useCrew();
  return <>{crew[role].name}</>;
}
