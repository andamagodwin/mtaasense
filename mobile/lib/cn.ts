import { clsx, type ClassValue } from 'clsx';
import { extendTailwindMerge } from 'tailwind-merge';

// `font-medium`/`font-semibold`/`font-bold` are Manrope families here, not weights (see tailwind.config.js), so
// they have to replace `font-sans` instead of stacking on top of it.
const twMerge = extendTailwindMerge({
  override: { classGroups: { 'font-weight': [{ 'font-weight': ['none'] }] } },
  extend: {
    classGroups: { 'font-family': [{ font: ['medium', 'semibold', 'bold', 'extrabold'] }] },
  },
});

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
