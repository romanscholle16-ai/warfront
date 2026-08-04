import type { LeaderAppearance } from '@warfront/shared';
import biden from '../assets/leaders/biden.jpg';
import bush from '../assets/leaders/bush.jpg';
import clinton from '../assets/leaders/clinton.jpg';
import harris from '../assets/leaders/harris.jpg';
import obama from '../assets/leaders/obama.jpg';
import pelosi from '../assets/leaders/pelosi.jpg';
import reagan from '../assets/leaders/reagan.jpg';
import trump from '../assets/leaders/trump.jpg';

/**
 * Cosmetic catalogue (M9 / monetization groundwork).
 *
 * This file lives in the CLIENT on purpose. Nothing here is imported by
 * `@warfront/shared`, which means no cosmetic can ever influence a simulation
 * outcome — that is the structural guarantee behind "no pay-to-win", not a promise.
 *
 * Leader avatars are REAL official portraits of recent and current heads of state.
 * All images are public-domain US federal government works (White House /
 * Congress official portraits), bundled into the client — no runtime downloads.
 */

export interface CosmeticOption {
  id: string;
  name: string;
  owned: boolean;
}

export const UNIFORMS: CosmeticOption[] = [
  { id: 'standard', name: 'Standard Dress', owned: true },
  { id: 'field', name: 'Field Uniform', owned: true },
  { id: 'desert', name: 'Desert Pattern', owned: true },
  { id: 'winter', name: 'Winter Pattern', owned: true },
  { id: 'ceremonial', name: 'Ceremonial', owned: false },
  { id: 'naval', name: 'Naval Whites', owned: false },
];

export const ACCESSORIES: CosmeticOption[] = [
  { id: 'none', name: 'None', owned: true },
  { id: 'beret', name: 'Beret', owned: true },
  { id: 'peaked', name: 'Peaked Cap', owned: true },
  { id: 'shades', name: 'Aviators', owned: true },
  { id: 'medals', name: 'Medal Rack', owned: false },
  { id: 'sash', name: 'Command Sash', owned: false },
];

export const FLAGS: CosmeticOption[] = [
  { id: 'plain', name: 'Plain', owned: true },
  { id: 'bars', name: 'Bars', owned: true },
  { id: 'star', name: 'Star', owned: true },
  { id: 'tricolor', name: 'Tricolour', owned: true },
  { id: 'eagle', name: 'Eagle', owned: false },
  { id: 'laurel', name: 'Laurel', owned: false },
];

/** Nation colours. The match assigns one by slot; this overrides it cosmetically. */
export const COLOURS: string[] = [
  '#e8493f', '#3f7fe8', '#3fbf6a', '#e8c53f', '#8e5ce8',
  '#e87f3f', '#3fd0d0', '#d03f9c', '#7f8fa6', '#b5e83f',
];

export const PORTRAIT_COUNT = 8;

/**
 * Real-leader avatars. `face` is the index stored in `appearance.face`, so the
 * whole existing appearance pipeline (server sync, view model) works unchanged.
 */
export interface LeaderStyleDef {
  id: string;
  name: string;
  title: string;
  blurb: string;
  /** Stored in appearance.face — index into LEADER_STYLES. */
  face: number;
  img: string;
  uniform: string;
  accessory: string;
  flag: string;
}

export const LEADER_STYLES: LeaderStyleDef[] = [
  { id: 'biden', name: 'Joe Biden', title: '46th President', blurb: 'Steady hand at the helm', face: 0, img: biden, uniform: 'standard', accessory: 'none', flag: 'plain' },
  { id: 'trump', name: 'Donald Trump', title: '45th & 47th President', blurb: 'Deals from strength', face: 1, img: trump, uniform: 'standard', accessory: 'none', flag: 'star' },
  { id: 'obama', name: 'Barack Obama', title: '44th President', blurb: 'A nation renews itself', face: 2, img: obama, uniform: 'standard', accessory: 'none', flag: 'bars' },
  { id: 'bush', name: 'George W. Bush', title: '43rd President', blurb: 'Decisive in the field', face: 3, img: bush, uniform: 'field', accessory: 'none', flag: 'star' },
  { id: 'clinton', name: 'Bill Clinton', title: '42nd President', blurb: 'Boom-time economics', face: 4, img: clinton, uniform: 'standard', accessory: 'none', flag: 'plain' },
  { id: 'reagan', name: 'Ronald Reagan', title: '40th President', blurb: 'The great communicator', face: 5, img: reagan, uniform: 'ceremonial', accessory: 'none', flag: 'bars' },
  { id: 'harris', name: 'Kamala Harris', title: '49th Vice President', blurb: 'First in line', face: 6, img: harris, uniform: 'standard', accessory: 'none', flag: 'plain' },
  { id: 'pelosi', name: 'Nancy Pelosi', title: 'Speaker Emerita', blurb: 'Commands the chamber', face: 7, img: pelosi, uniform: 'standard', accessory: 'none', flag: 'tricolor' },
];

/** The portrait element for an appearance — a real photo, not an emoji. */
export function leaderIcon(appearance: Partial<LeaderAppearance>): string {
  const style = LEADER_STYLES[appearance.face ?? 0] ?? LEADER_STYLES[0]!;
  return `<img class="leader-avatar" src="${style.img}" alt="${style.name}" />`;
}

export function optionName(list: CosmeticOption[], id: string): string {
  return list.find((option) => option.id === id)?.name ?? id;
}
