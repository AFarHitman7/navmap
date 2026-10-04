import type { IndoorZoneV3, NodeV3 } from './contract-v3';

export type FloorVisibility = number | 'all' | 'hidden';
export type ZoneFloorVisibility = Record<string, FloorVisibility>;

export function resolveFloorVisibility(zones: IndoorZoneV3[], choices: ZoneFloorVisibility): ZoneFloorVisibility {
  return Object.fromEntries(zones.map((zone) => {
    const choice = choices[zone.id];
    const valid = choice === 'all' || choice === 'hidden' || zone.floors.some((floor) => floor.z === choice);
    return [zone.id, valid ? choice : zone.floors.find((floor) => floor.z === 0)?.z ?? zone.floors[0].z];
  }));
}

export function isNodeVisible(node: Pick<NodeV3, 'zoneId' | 'z'>, visibility?: ZoneFloorVisibility, showOutdoors = true): boolean {
  if (node.zoneId === null) return showOutdoors;
  const floor = visibility?.[node.zoneId];
  return floor !== 'hidden' && (floor === undefined || floor === 'all' || floor === node.z);
}
