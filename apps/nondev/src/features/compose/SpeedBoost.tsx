// "Speed" for the next message: a small menu button above the reply box, beside Thinking depth.
import { ChevronDown, Zap } from "lucide-react";

import type { SpeedLevel } from "../../plain/autonomy";
import { Button } from "../../ui/Button";
import { SegmentedControl } from "../../ui/SegmentedControl";
import { Popover } from "../../ui/Popover";
import { shownSpeed, speedCopy, speedCosts, type SpeedModel } from "./speedChoice";

export function SpeedBoost({
  model,
  remembered,
  onPick,
  disabled,
}: {
  readonly model: SpeedModel;
  readonly remembered: SpeedLevel | undefined;
  readonly onPick: (level: SpeedLevel) => void;
  readonly disabled?: boolean;
}) {
  const level = shownSpeed(model, remembered);
  const choice = model.speed.choices.find((entry) => entry.level === level)!;
  const cost = speedCosts[level] ?? choice.costNote;
  return (
    <div className="fm-speed">
      <Popover
        label={speedCopy.label}
        role="dialog"
        placement="top-start"
        trigger={
          <Button size="sm" disabled={disabled}>
            <Zap size={14} strokeWidth={1.8} aria-hidden />
            {speedCopy.label}: {choice.label}
            <ChevronDown size={12} strokeWidth={2} aria-hidden />
          </Button>
        }
      >
        <div className="fm-speed__panel">
          <p className="fm-speed__intro">{speedCopy.intro}</p>
          <SegmentedControl
            label={speedCopy.label}
            size="sm"
            block
            value={level}
            onChange={onPick}
            options={model.speed.choices.map((entry) => ({
              value: entry.level,
              label: entry.label,
              ...(entry.level === model.usual ? { tag: { text: speedCopy.usual } } : {}),
            }))}
          />
          <p className="fm-speed__what">{choice.description}</p>
          {cost ? <p className="fm-speed__cost">{cost}</p> : null}
        </div>
      </Popover>
    </div>
  );
}
