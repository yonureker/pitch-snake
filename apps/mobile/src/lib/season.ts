/**
 * The season clock, shared by every surface that shows a monthly number so
 * they all agree on where a month begins. A season is a UTC calendar month
 * keyed 'YYYY-MM', exactly as the server seasons on (rating.sql), so the app's
 * this-month boards, HUD best and stats line up with the ladder that resets.
 * @module
 */

const MONTHS = [
  'JANUARY',
  'FEBRUARY',
  'MARCH',
  'APRIL',
  'MAY',
  'JUNE',
  'JULY',
  'AUGUST',
  'SEPTEMBER',
  'OCTOBER',
  'NOVEMBER',
  'DECEMBER',
] as const;

/** This UTC calendar month as 'YYYY-MM'. */
export function currentSeason(): string {
  const d = new Date();
  return `${String(d.getUTCFullYear())}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

/** The month name for a title face, e.g. "SEPTEMBER". */
export function seasonLabel(): string {
  return MONTHS[new Date().getUTCMonth()] ?? 'THIS MONTH';
}
