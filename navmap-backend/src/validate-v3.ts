import type { DraftV3 } from './draft.js';
import { containsBounds, containsPoint, rectsOverlap } from './geo-v3.js';
import { validatePathGroups } from './path-validation.js';

/**
 * Publish-time semantic checks for the unified v3 model.
 * Syntactic shape is enforced by zod; this covers cross-field geometry,
 * membership, and edge-kind rules. Boundary-only maps are valid.
 */
export function validatePublishV3(draft: DraftV3): string[] {
  const errors: string[] = [];
  if (!draft.boundary) {
    errors.push('venue needs an outdoor boundary');
    return errors;
  }
  const boundary = draft.boundary;
  const zoneById = new Map(draft.indoorZones.map((z) => [z.id, z]));
  const seenZones = new Set<string>();
  for (const zone of draft.indoorZones) {
    if (seenZones.has(zone.id)) errors.push(`duplicate id: ${zone.id}`);
    seenZones.add(zone.id);
    if (!containsBounds(boundary, zone.bounds)) {
      errors.push(`zone ${zone.id} is outside the outdoor boundary`);
    }
    const zs = zone.floors.map((f) => f.z);
    if (new Set(zs).size !== zs.length) errors.push(`zone ${zone.id} has duplicate floor z values`);
  }
  for (let i = 0; i < draft.indoorZones.length; i++) {
    for (let j = i + 1; j < draft.indoorZones.length; j++) {
      const a = draft.indoorZones[i]!;
      const b = draft.indoorZones[j]!;
      if (rectsOverlap(a.bounds, b.bounds)) {
        errors.push(`zones ${a.id} and ${b.id} overlap`);
      }
    }
  }
  const nodeById = new Map(draft.nodes.map((n) => [n.id, n]));
  const seenNodes = new Set<string>();
  for (const node of draft.nodes) {
    if (seenNodes.has(node.id)) errors.push(`duplicate id: ${node.id}`);
    seenNodes.add(node.id);
    if (!containsPoint(boundary, node.lat, node.lng)) {
      errors.push(`node ${node.id} is outside the outdoor boundary`);
      continue;
    }
    if (node.zoneId === null) {
      if (node.z !== 0) errors.push(`outdoor node ${node.id} must use z: 0`);
      for (const zone of draft.indoorZones) {
        if (containsPoint(zone.bounds, node.lat, node.lng)) {
          errors.push(`outdoor node ${node.id} lies inside zone ${zone.id}`);
          break;
        }
      }
    } else {
      const zone = zoneById.get(node.zoneId);
      if (!zone) {
        errors.push(`node ${node.id} refers to unknown zone ${node.zoneId}`);
        continue;
      }
      if (!containsPoint(zone.bounds, node.lat, node.lng)) {
        errors.push(`node ${node.id} lies outside its zone ${zone.id}`);
      }
      if (!zone.floors.some((f) => f.z === node.z)) {
        errors.push(`node ${node.id} uses unknown floor z=${node.z} in zone ${zone.id}`);
      }
    }
  }
  for (const edge of draft.edges) {
    const from = nodeById.get(edge.from);
    const to = nodeById.get(edge.to);
    if (!from) errors.push(`edge refers to unknown node ${edge.from}`);
    if (!to) errors.push(`edge refers to unknown node ${edge.to}`);
    if (!from || !to) continue;
    if (edge.kind === 'path') {
      if ((from.zoneId ?? null) !== (to.zoneId ?? null) || from.z !== to.z) {
        errors.push(`path edge ${edge.from}->${edge.to} must stay in the same zone and floor`);
      }
    } else if (edge.kind === 'entrance') {
      const outdoorIndoor =
        (from.zoneId === null && to.zoneId !== null) || (to.zoneId === null && from.zoneId !== null);
      if (!outdoorIndoor) errors.push(`entrance edge ${edge.from}->${edge.to} must connect outdoors to a building`);
      const indoor = from.zoneId === null ? to : from;
      if (indoor.zoneId !== null && indoor.z !== 0) {
        errors.push(`entrance edge ${edge.from}->${edge.to} must land on the ground floor`);
      }
    } else {
      // stairs | elevator: same building, different floors.
      if (from.zoneId === null || to.zoneId === null || from.zoneId !== to.zoneId) {
        errors.push(`${edge.kind} edge ${edge.from}->${edge.to} must stay within one building`);
      } else if (from.z === to.z) {
        errors.push(`${edge.kind} edge ${edge.from}->${edge.to} must connect different floors`);
      }
    }
  }
  errors.push(...validatePathGroups(draft));
  return errors;
}
