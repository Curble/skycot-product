// "Thinking depth" for the next message: a small menu button above the reply box.
import { Brain, ChevronDown } from "lucide-react";

import type { CareLevel } from "../../plain/autonomy";
import { Button } from "../../ui/Button";
import { SegmentedControl } from "../../ui/SegmentedControl";
import { Popover } from "../../ui/Popover";
import { depthCopy, shownDepth, type DepthModel } from "./depthChoice";

export function ThinkingDepth({
  model,
  remembered,
  onPick,
  disabled,
}: {
  readonly model: DepthModel;
  readonly remembered: CareLevel | undefined;
  readonly onPick: (level: CareLevel) => void;
  readonly disabled?: boolean;
}) {
  const level = shownDepth(model, remembered);
  const choice = model.care.choices.find((entry) => entry.level === level)!;
  return (
    <div className="fm-depth">
      <Popover
        label={depthCopy.label}
        role="dialog"
        placement="top-start"
        trigger={
          <Button size="sm" disabled={disabled}>
            <Brain size={14} strokeWidth={1.8} aria-hidden />
            {depthCopy.label}: {choice.label}
            <ChevronDown size={12} strokeWidth={2} aria-hidden />
          </Button>
        }
      >
        <div className="fm-depth__panel">
          <p className="fm-depth__intro">{depthCopy.intro}</p>
          <SegmentedControl
            label={depthCopy.label}
            size="sm"
            block
            value={level}
            onChange={onPick}
            options={model.care.choices.map((entry) => ({
              value: entry.level,
              label: entry.label,
              ...(entry.level === model.usual ? { tag: { text: depthCopy.usual } } : {}),
            }))}
          />
          <p className="fm-depth__what">{choice.description}</p>
          {choice.costNote ? <p className="fm-depth__cost">{choice.costNote}</p> : null}
        </div>
      </Popover>
    </div>
  );
}
