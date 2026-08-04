import type { TechDef, TechTree } from '../types.js';
export declare const TECHS: TechDef[];
export declare const TECH_BY_ID: Record<string, TechDef>;
export declare const TECH_BRANCHES: {
    tree: TechTree;
    branch: string;
    label: string;
}[];
/** The tech that must be completed before `techId` becomes available (null for level 1). */
export declare function techPrerequisite(techId: string): string | null;
/** Every tech the player could start right now, given what they already own. */
export declare function availableTechs(owned: readonly string[]): TechDef[];
//# sourceMappingURL=tech.d.ts.map