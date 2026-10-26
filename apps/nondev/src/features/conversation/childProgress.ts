/** A short, private progress sentence that never repeats a query, path or command. */
export function childProgressSentence(kind: string): string {
  switch (kind) {
    case "web":
      return "Looking something up on the internet";
    case "search":
      return "Looking through your project";
    case "command":
      return "Working on your project";
    case "edit":
      return "Saving a change";
    case "read":
      return "Checking a project file";
    case "subagent":
      return "Sam is getting help";
    case "install":
      return "Getting a tool ready";
    case "test":
      return "Checking the page";
    default:
      return "Sam is checking the next step";
  }
}
