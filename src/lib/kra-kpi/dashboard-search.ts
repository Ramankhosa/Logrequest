export function normalizeDashboardSearch(value: string | null | undefined): string {
  return (value ?? "").toLowerCase().trim().replace(/\s+/g, " ");
}

export function matchesDashboardSearch(
  query: string,
  ...values: Array<string | null | undefined>
): boolean {
  const normalizedQuery = normalizeDashboardSearch(query);
  if (!normalizedQuery) {
    return true;
  }

  return values.some((value) =>
    normalizeDashboardSearch(value).includes(normalizedQuery),
  );
}
