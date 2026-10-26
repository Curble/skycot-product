// Home's "On the fridge" tile: the three magnets at the top of the fridge, each opening its
// page with "Open it", and the way to the whole fridge. Hidden until something has been made.
import { useAtomValue } from "@effect/atom-react";
import { useEffect } from "react";

import { FRIDGE_HREF } from "../../router";
import { enabledEnvironmentIdsAtom } from "../../state/catalog";
import { conversationRowsAtom } from "../../state/conversations";
import { Card, CardBody, CardHeader } from "../../ui/Card";
import { useOpenIt } from "../starters/PreviewSheet";
import { homeMagnets } from "./fridge";
import { FridgeMagnet } from "./FridgeMagnet";
import { useHourClock } from "./FridgeScreen";
import { refreshFridge, useFridge } from "./store";
import "./fridge.css";

export function FridgeHomeTile() {
  const fridge = useFridge();
  const environmentIds = useAtomValue(enabledEnvironmentIdsAtom);
  const rows = useAtomValue(conversationRowsAtom);
  const environmentId = environmentIds[0] ?? null;
  const now = useHourClock();
  const openIt = useOpenIt(environmentId);
  useEffect(() => {
    void refreshFridge();
  }, [rows[0]?.at]);
  const magnets = homeMagnets(fridge.items);
  if (magnets.length === 0) return null;
  return (
    <Card label="On the fridge">
      <CardHeader title="On the fridge" subtitle={<a href={FRIDGE_HREF}>See the whole fridge</a>} />
      <CardBody>
        <div className="fm-fridge__tile">
          {magnets.map((item, index) => (
            <FridgeMagnet
              key={item.threadId}
              item={item}
              index={index}
              now={now}
              maker={null}
              compact
              onOpen={() => openIt.openIt(item)}
            />
          ))}
        </div>
      </CardBody>
      {openIt.sheet}
    </Card>
  );
}
