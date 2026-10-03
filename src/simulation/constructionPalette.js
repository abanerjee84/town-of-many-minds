import { CELL_KIND, ZONE } from '../core/config.js';
import { constructionBlockDemand, constructionBlockQuote, listConstructionBlocks } from '../kits/constructionBlocks.js';

const ZONE_FOR_FAMILY = {
  housing: ZONE.RESIDENTIAL,
  commerce: ZONE.COMMERCIAL,
  civic: ZONE.CIVIC,
  industry: ZONE.INDUSTRIAL
};

function hasFootprint(town, block, zone) {
  const g = town?.grid;
  if (!g) return false;
  const [cols, rows] = block.footprint;
  for (let y = 0; y <= g.h - rows; y++) {
    for (let x = 0; x <= g.w - cols; x++) {
      let open = true;
      let roadTouch = false;
      for (let dy = 0; dy < rows && open; dy++) {
        for (let dx = 0; dx < cols; dx++) {
          const cx = x + dx;
          const cy = y + dy;
          const kind = g.kindAt(cx, cy);
          if (kind !== CELL_KIND.EMPTY && kind !== CELL_KIND.LOT) { open = false; break; }
          if (town.resources?.ownsCell?.(cx, cy) || town.buildingAt?.(cx, cy)) { open = false; break; }
          const target = ZONE_FOR_FAMILY[block.family];
          if (!target || g.zone[g.idx(cx, cy)] === target) {
            roadTouch ||= [[1, 0], [-1, 0], [0, 1], [0, -1]]
              .some(([ddx, ddy]) => g.isRoad(cx + ddx, cy + ddy));
          }
        }
      }
      if (open && roadTouch) return true;
    }
  }
  return false;
}

/**
 * Return the same construction choices the council can quote, grouped by kit
 * family and filtered against the live map, zone and treasury runway. This is
 * deliberately data-only so a future player editor and the LLM prompt can
 * consume it without duplicating placement rules.
 */
export function constructionPalette(town, opts = {}) {
  const eco = town?.economy?.stats?.() || {};
  const reserve = Number(opts.reserve ?? eco.reserve ?? 0);
  const cash = Math.max(0, Number(eco.treasury || 0) - reserve);
  const filter = opts.family || opts.kit ? { family: opts.family, kit: opts.kit } : {};
  const rows = listConstructionBlocks(filter).map((block) => {
    const quote = constructionBlockQuote(block.id, { town });
    const mapZone = opts.zone || null;
    const zoneOk = !mapZone || ZONE_FOR_FAMILY[block.family] === mapZone;
    const footprint = hasFootprint(town, block, mapZone);
    const affordable = quote.cost <= cash;
    const demanded = constructionBlockDemand(block.id, town);
    const reason = !zoneOk ? 'zone filter' : !demanded ? 'demand gate not met' : !footprint ? 'no connected footprint' : !affordable ? 'below runway' : '';
    return { ...block, quote, available: !reason, reason };
  });
  const groups = {};
  for (const row of rows) (groups[row.family] ||= []).push(row);
  return { cash, reserve, groups, rows };
}
