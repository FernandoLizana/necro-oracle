// @necro/ui-crt — demo catalog (pure, client-safe).
//
// `DEMO_CATALOG` is the fixed Demo_Catalog: the purpose-built graveyard demos
// the terminal can replay offline, in authored order — `lich-py2` (a legacy
// Python 2 repository), `mixed-ruins` (a partly-ruined mixed repository) and
// `green-garden` (a healthier repository) (R18.1). `DEMO_NAME_PATTERN` is the
// Demo_Name rule `^[a-z0-9-]{1,32}$`: lowercase letters, digits and hyphens,
// 1–32 chars, so an unknown `demo <name>` can be told apart from a malformed
// one (R6.1, R18.1).
//
// _Requirements: R5.3, R6.1, R18.1_

/** The Demo_Name rule: lowercase letters, digits and hyphens, 1–32 chars. */
export const DEMO_NAME_PATTERN = /^[a-z0-9-]{1,32}$/;

/**
 * The fixed Demo_Seed (visual-necromancy, task 13.1, R9.1). In Demo mode the
 * Visual_Layer drives every Glitch_Effect corruption and Rot_Transform from this
 * single constant rather than from the wall clock or unseeded randomness, so a
 * Demo reading renders identically across two renders (reproducibility, R9.2).
 * The value spells `"nec"` (0x6e 0x65 0x63).
 */
export const DEMO_SEED = 0x6e6563;

/** One entry in the Demo_Catalog. */
export interface DemoCatalogEntry {
  readonly name: string;
  readonly description: string;
}

/** The fixed Demo_Catalog, in authored order (R18.1). */
export const DEMO_CATALOG: readonly DemoCatalogEntry[] = [
  { name: "lich-py2", description: "A legacy Python 2 repository, long dead." },
  { name: "mixed-ruins", description: "Half-ruined: some stones still stand." },
  { name: "green-garden", description: "A healthier repository, tended and alive." },
];
