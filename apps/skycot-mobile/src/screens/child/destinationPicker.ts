// nondev-seam: skycot-iphone-q39-destination-picker
export function shouldShowDestinationPicker(
  projectCount: number,
  questionSpaceCount: number,
): boolean {
  return projectCount > 1 || questionSpaceCount > 1;
}

export function shouldStartFreshPage(hasSelectedProject: boolean, makeNewPage: boolean): boolean {
  return !hasSelectedProject || makeNewPage;
}
