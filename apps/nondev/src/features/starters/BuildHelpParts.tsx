// Small pieces every build-help screen shares: the labelled "Change how I build" control in the
// sheet header, the "Just type it myself" link at the foot, and the cloud in the header.
import { SlidersHorizontal } from "lucide-react";

import { Mascot } from "../brand/Mascot";
import { Button } from "../../ui/Button";

/** The way back to the three-card chooser; always labelled, never an icon on its own. */
export function ChangeHowButton({ onClick }: { readonly onClick: () => void }) {
  return (
    <Button size="sm" icon={SlidersHorizontal} onClick={onClick}>
      Change how I build
    </Button>
  );
}

/** Skips the picker: the plain card sentence goes in the box, as a tap on a card always did. */
export function TypeMyselfLink({ onClick }: { readonly onClick: () => void }) {
  return (
    <div className="fm-bh__foot">
      <button type="button" className="fm-bh__type" onClick={onClick}>
        Just type it myself
      </button>
    </div>
  );
}

export function SamArt() {
  return <Mascot pose="hello" size={44} decorative />;
}
