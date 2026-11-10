// Notices travel through the app as plain strings. A failure carries the
// "Error: " prefix a thrown Error already prints, so whoever shows the notice
// can tell it apart from a confirmation and drop the prefix.
const PREFIX = /^(?:\w*Error:\s*)+/;

export function failed(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return `Error: ${text.replace(PREFIX, "")}`;
}

export function readNotice(notice: string): { text: string; failed: boolean } {
  const text = notice.replace(PREFIX, "");
  return { text, failed: text !== notice };
}
