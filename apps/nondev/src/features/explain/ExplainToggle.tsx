// The per-conversation switch for "How did you do that?" mode, in the conversation's strip.
import { useFamily } from "../family/FamilyProvider";
import { Switch } from "../../ui/Switch";
import { useExplainMode } from "./explainMode";
import "./explain.css";

export function ExplainToggle({ threadId }: { readonly threadId: string }) {
  const family = useFamily();
  const [on, setOn] = useExplainMode(threadId, family.enabled);
  const labelId = `explain-toggle-${threadId}`;
  return (
    <span className="fm-explain-toggle">
      <span id={labelId}>How did you do that?</span>
      <Switch checked={on} onChange={setOn} label="Explain each change" labelledBy={labelId} />
    </span>
  );
}
