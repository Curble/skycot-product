// A child puts a project away: it leaves their lists at once, nothing is deleted, and an Undo
// shows for ten seconds. The engine decides who may (only a project that is theirs) and how
// long the Undo works (fifteen seconds), so a page that stays open cannot stretch it.
import { bringBackProject, putAwayProject } from "../family/store";
import { isNotTheirsMessage, NOT_THEIRS_MESSAGE } from "../family/ownership";
import { showToast } from "../../ui/Toast";

export const PUT_AWAY_UNDO_MS = 10_000;

export const putAwayLine = (title: string) => `Put ${title} away`;

export async function putProjectAway(project: {
  readonly id: string;
  readonly title: string;
}): Promise<boolean> {
  const result = await putAwayProject(project.id);
  if (!result.ok) {
    showToast(
      isNotTheirsMessage(result.message) ? NOT_THEIRS_MESSAGE : "That didn't go. Try again.",
    );
    return false;
  }
  showToast(
    putAwayLine(project.title),
    {
      label: "Undo",
      run: async () => {
        const undone = await bringBackProject(project.id);
        if (!undone.ok) showToast("That's put away. A grown-up can bring it back.");
      },
    },
    PUT_AWAY_UNDO_MS,
  );
  return true;
}
