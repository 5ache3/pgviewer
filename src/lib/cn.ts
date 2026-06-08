import { clsx, type ClassValue } from "clsx";

/** Conditional className join (no Tailwind merge — keep class lists explicit). */
export function cn(...inputs: ClassValue[]): string {
  return clsx(inputs);
}
