/**
 * Names of the lightweight DOM CustomEvents used to bridge global keyboard
 * shortcuts to focus-related behaviour inside specific components, without
 * threading refs through the whole tree.
 */
export const FOCUS_SQL_EVENT = "pg:focus-sql";
export const FOCUS_FILTER_EVENT = "pg:focus-filter";

export function emit(event: string): void {
  window.dispatchEvent(new Event(event));
}
