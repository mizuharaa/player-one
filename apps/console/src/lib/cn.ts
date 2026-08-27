import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** shadcn/ui's class merger, so its components drop in without a shim. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
