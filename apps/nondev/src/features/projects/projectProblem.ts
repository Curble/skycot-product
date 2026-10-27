export function projectCreationProblem(message: string): string {
  if (/EEXIST|already exists|file exists/i.test(message)) {
    return "A folder with that name already exists. Try another name.";
  }
  if (/EACCES|EPERM|permission denied|operation not permitted/i.test(message)) {
    return "SKYCOT can't make a folder there. Ask a grown-up to check the Mac's folder access.";
  }
  if (/ENOSPC|no space left/i.test(message)) {
    return "The Mac is out of space, so SKYCOT couldn't make the project.";
  }
  if (/ENOENT|no such file|not found/i.test(message)) {
    return "The place for this project isn't there any more. Ask a grown-up to check the Mac.";
  }
  return "The project folder couldn't be made. Try again, or ask a grown-up to check the Mac.";
}
