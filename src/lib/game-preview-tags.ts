/** Source-inspection DOM attributes are not valid Three.js object properties. */
export function stripGamePreviewTags(code: string, id: string): string {
  if (!/(?:^|\/)src\/game\/.*\.[jt]sx(?:\?|$)/.test(id.replaceAll("\\", "/"))) return code;
  return code.replace(/\s+data-tsd-source=(?:"[^"]*"|'[^']*')/g, "");
}