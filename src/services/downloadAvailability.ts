/** Keep pages stable so loading more catalog entries reuses earlier availability results. */
export function availabilityBatches(titles: readonly string[], size = 24): string[][] {
  const unique = [...new Set(titles)];
  const batches: string[][] = [];
  for (let i = 0; i < unique.length; i += size) batches.push(unique.slice(i, i + size));
  return batches;
}
