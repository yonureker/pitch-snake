/**
 * Mode names, shared by the loop, the data layer, and the screen. A RULE
 * mode is what the engine runs (its config comes from the engine's MODES
 * table); the UI additionally knows 'tourney', which is a lobby around one
 * of the rule modes, never a ruleset of its own.
 * @module
 */

/** A ruleset the engine can run. */
export type RuleMode = 'classic' | 'speedrun' | 'survival';

/** What the mode picker shows; 'tourney' resolves to the tournament's own
 *  rule mode, and 'versus' is a room, which plays and is rated as classic. */
export type UiMode = RuleMode | 'tourney' | 'versus';

/** Type guard for values arriving from storage or the network. */
export function isRuleMode(v: unknown): v is RuleMode {
  return v === 'classic' || v === 'speedrun' || v === 'survival';
}
