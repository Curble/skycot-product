// Home's "On the fridge" tile: the three magnets at the top of the fridge, each opening its
// page with "Open it", and the way to the whole fridge. Hidden until something has been made.
import { useAtomValue } from "@effect/atom-react";
import { useEffect, useState } from "react";

import { FRIDGE_HREF } from "../../router";
import { enabledEnvironmentIdsAtom } from "../../state/catalog";
import { Card, CardBody, CardHeader } from "../../ui/Card";
import { PreviewSheet } from "../starters/PreviewSheet";
import { homeMagnets, type FridgeItem } from "./fridge";
import { FridgeMagnet } from "./FridgeMagnet";
import { useHourClock } from "./FridgeScreen";
import { refreshFridge, useFridge } from "./store";
import "./fridge.css";

export function FridgeHomeTile() {
  const fridge = useFridge();
  const environmentIds = useAtomValue(enabledEnvironmentIdsAtom);
  const environmentId = environmentIds[0] ?? null;
  const now = useHourClock();
  const [open, setOpen] = useState<FridgeItem | null>(null);
  useEffect(() => {
    void refreshFridge();
  }, []);
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
              environmentId={environmentId}
              now={now}
              maker={null}
              compact
              onOpen={() => setOpen(item)}
            />
          ))}
        </div>
      </CardBody>
      {open !== null && environmentId !== null ? (
        <PreviewSheet
          open
          onClose={() => setOpen(null)}
          environmentId={environmentId}
          cwd={open.cwd}
          relativePath={open.page}
        />
      ) : null}
    </Card>
  );
}
