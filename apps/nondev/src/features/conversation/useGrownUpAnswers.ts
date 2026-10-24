// Who answered the held requests in one conversation, for the child's cards ("Mum said yes").
// Same pattern as useAssistantSwitches: asked again whenever `refreshKey` changes (a request
// settling), the key riding in the query so no cache answers with an older list.
import { useEffect, useState } from "react";

import { parseGrownUpAnswers, type GrownUpAnswer } from "../../plain/grownUpAnswers";
import { engineRequest } from "../family/api";

const ANSWERS_PATH = "/api/skycot/family/grown-up-answers";

export function useGrownUpAnswers(
  threadId: string,
  refreshKey: string,
  enabled: boolean,
): ReadonlyMap<string, GrownUpAnswer> {
  const [answers, setAnswers] = useState<ReadonlyMap<string, GrownUpAnswer>>(new Map());
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    void engineRequest("GET", ANSWERS_PATH, undefined, parseGrownUpAnswers, {
      threadId,
      key: refreshKey,
    }).then((result) => {
      if (!live || !result.ok) return;
      setAnswers(new Map(result.value.map((entry) => [entry.requestId, entry])));
    });
    return () => {
      live = false;
    };
  }, [threadId, refreshKey, enabled]);
  return answers;
}
