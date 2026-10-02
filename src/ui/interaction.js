import * as THREE from 'three';
import { CELL, CELL_KIND, ZONE } from '../core/config.js';
import { ROAD_FEATURE, ROAD_FEATURE_LABEL } from '../core/grid.js';
import { traitLabel } from '../kits/citizens/personality.js';
import { stageLabel, scheduleAt, EDUCATION_LABEL } from '../kits/citizens/citizenProfile.js';
import { typeLabel, roleLabel } from '../kits/vehicles/vehicleKit.js';
import { FACTORY_TYPES, FACTORY_SIZES } from '../simulation/industry.js';
import { urbanProfile, onIndustrialGround } from '../placement/placementController.js';
import { buildingLoad } from '../simulation/growth.js';
import { constructionPalette } from '../simulation/constructionPalette.js';
import { events } from '../core/events.js';
import { esc } from './escape.js';

/** Player-facing labels + why-lines for the unified decisions feed. */
const PLAYER_WHY = {
  road: 'you laid it to connect the network',
  path: 'you laid it to unlock an inland lot',
  bulldoze: 'you cleared it to free the lot',
  house: 'you built it to add beds',
  factory: 'you commissioned it to cover scarce materials',
  park: 'you added it for amenity and leisure',
  tree: 'you planted it as street improvement',
  lamp: 'you placed it for night lighting',
  car: 'you added a vehicle and driver',
  citizen: 'you moved a newcomer into a free home'
};

/**
 * Phase 20 (C3b) — the building kind's own noun, in ONE place. The hover
 * label and the inspector used to carry two copies of this chain; an office
 * would have fallen through both to "House".
 */
function buildingKindLabel(b) {
  if (b.kind === 'office') return 'Office block';
  if (b.kind === 'shop') return 'Shop';
  if (b.kind === 'civic') return 'Civic building';
  if (b.kind === 'factory') return 'Factory';
  if (b.kind === 'house') return 'Residence';
  return 'Building';
}

function fmtMoney(v) {
  if (v == null) return '—';
  return `$${Math.round(v).toLocaleString('en-US')}`;
}

/** Pinned to the top of every inspector render: the two history buttons. */
const INSPECTOR_TOP = `
  <div class="insp-top">
    <button class="insp-btn" data-modal="council">Decisions</button>
    <button class="insp-btn" data-modal="trade">Trade</button>
    <button class="insp-btn" data-modal="construction">Palette</button>
  </div>`;

/** Escape arbitrary (LLM-authored) text before it goes near innerHTML. Phase 29:
 *  the implementation now lives in ./escape.js so the HUD and this file cannot
 *  drift apart again — this file's copy skipped `'` and the HUD's skipped the
 *  same characters in a different order. */

const TOOLS = [
  { id: 'select', label: 'Inspect', hint: 'Click a citizen, vehicle, building or road to inspect it.' },
  { id: 'road', label: 'Road', hint: 'Paint road tiles. Roads auto-connect and rebuild sidewalks.' },
  { id: 'path', label: 'Footway', hint: 'Lay a footpath from open land to the nearest street.' },
  { id: 'bulldoze', label: 'Bulldoze', hint: 'Remove a building, road, park or prop from a cell.' },
  { id: 'house', label: 'House', hint: 'Build on an empty cell that touches a road.' },
  { id: 'factory', label: 'Factory', hint: 'Commission a works on an empty cell by a road.' },
  { id: 'park', label: 'Park', hint: 'Convert a cell into parkland with trees and benches.' },
  { id: 'tree', label: 'Tree', hint: 'Plant a tree on the selected cell.' },
  { id: 'lamp', label: 'Lamp', hint: 'Place a street lamp (glows at night).' },
  { id: 'car', label: '+ Car', hint: 'Spawn a vehicle with a new driver personality.' },
  { id: 'citizen', label: '+ Citizen', hint: 'Move a new citizen into a free home.' }
];

const $ = (id) => document.getElementById(id);

export class Interaction {
  constructor({ camera, dom, town, clock }) {
    this.camera = camera;
    this.dom = dom;
    this.town = town;
    this.clock = clock;
    this.tool = 'select';
    this.selection = null;
    this.raycaster = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.downPos = null;
    this.hoverCell = null;
    this._acc = 0;

    this.highlight = new THREE.Mesh(
      new THREE.BoxGeometry(CELL, 0.08, CELL),
      new THREE.MeshBasicMaterial({
        color: 0x7ee787,
        transparent: true,
        opacity: 0.4,
        depthWrite: false
      })
    );
    this.highlight.position.y = 0.24;
    this.highlight.visible = false;
    this.highlight.renderOrder = 5;
    this.highlight.raycast = () => {};

    this.hoverLabel = document.createElement('div');
    this.hoverLabel.id = 'hover-label';
    this.hoverLabel.style.cssText =
      'position:absolute;pointer-events:none;padding:3px 7px;border-radius:6px;' +
      'background:rgba(10,14,20,.85);border:1px solid rgba(255,255,255,.12);' +
      'color:#e6edf3;font-size:11px;transform:translate(-50%,-160%);white-space:nowrap;display:none';
    document.body.appendChild(this.hoverLabel);

    this.buildToolPalette();
    this.bind();
    this.bindHistoryPanels();
  }

  get container() {
    return this.dom.parentElement;
  }

  buildToolPalette() {
    const grid = $('tool-grid');
    grid.innerHTML = '';
    for (const t of TOOLS) {
      const b = document.createElement('button');
      b.textContent = t.label;
      b.dataset.tool = t.id;
      b.title = t.hint;
      b.addEventListener('click', () => this.setTool(t.id));
      grid.appendChild(b);
    }
    this.setTool('select');
  }

  /**
   * Phase 38 (S19h) — the hint line in the Construction-kit ribbon.
   *
   * The panel used to carry a static four-part prose line ("Drag: orbit /
   * Right-drag: pan / Wheel: zoom / Click: use tool") under a grid of tools
   * that each already had their own `hint`. Turned into a bottom ribbon there
   * is no room for static prose, and none is needed: what a reader wants beside
   * a tool row is what the SELECTED tool does. Camera controls belong in a
   * title/tooltip, not in a permanent line competing with the tools.
   */
  toolHint(tool) {
    const el = $('tool-hint');
    if (!el) return;
    const t = TOOLS.find((x) => x.id === tool);
    el.textContent = t ? t.hint : '';
  }

  setTool(id) {
    this.tool = id;
    const meta = TOOLS.find((t) => t.id === id);
    for (const b of document.querySelectorAll('#tool-grid button')) {
      b.classList.toggle('active', b.dataset.tool === id);
    }
      if (meta) this.toolHint(id);
    this.highlight.material.color.set(id === 'bulldoze' ? 0xff6b6b : id === 'select' ? 0x79c0ff : 0x7ee787);
  }

  setPointer(e) {
    const rect = this.dom.getBoundingClientRect();
    this.pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointer, this.camera);
  }

  bind() {
    this.dom.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      this.downPos = { x: e.clientX, y: e.clientY };
    });

    this.dom.addEventListener('pointerup', (e) => {
      if (e.button !== 0 || !this.downPos) return;
      const moved = Math.hypot(e.clientX - this.downPos.x, e.clientY - this.downPos.y);
      this.downPos = null;
      if (moved > 6) return;
      this.setPointer(e);
      this.handleClick();
    });

    this.dom.addEventListener('pointermove', (e) => {
      this.setPointer(e);
      this.updateHover(e);
    });

    this.dom.addEventListener('pointerleave', () => {
      this.highlight.visible = false;
      this.hoverLabel.style.display = 'none';
    });
  }

  /**
   * The cell a resource structure sits on, hit-tested against the resource
   * meshes. The ground-plane projection is not enough: on a tall turbine or a
   * barn it lands past the footprint and picks a neighbouring tile, which is
   * how these sites ended up looking uninspectable.
   */
  resourceCell() {
    const res = this.town.resources;
    if (!res?.group || !res.group.children.length) return null;
    const hits = this.raycaster.intersectObject(res.group, true);
    if (!hits.length) return null;
    const p = hits[0].point;
    const { x, y } = this.town.grid.worldToCell(p.x, p.z);
    return this.town.grid.inBounds(x, y) ? { x, y, point: p } : null;
  }

  updateHover() {
    const now = performance.now();
    if (now - (this._hoverAt || 0) < 40) return;
    this._hoverAt = now;

    const agent = this.town.pick(this.raycaster);
    if (agent) {
      this.highlight.visible = false;
      const p = agent.pick;
      const extra = p.agent ? (p.agent.p ? ` · ${p.agent.p.job.label}` : '') : '';
      this.showLabel(`${p.title}${extra}`);
      return;
    }

    const cell = this.resourceCell() || this.town.cellFromGround(this.raycaster);
    if (!cell) {
      this.highlight.visible = false;
      this.hoverLabel.style.display = 'none';
      return;
    }
    this.hoverCell = cell;
    const p = this.town.grid.cellToWorld(cell.x, cell.y);
    this.highlight.position.x = p.x;
    this.highlight.position.z = p.z;
    this.highlight.visible = true;

    const valid = this.canApply(cell.x, cell.y);
    this.highlight.material.opacity = valid === false ? 0.22 : 0.42;
    this.showLabel(this.cellLabel(cell.x, cell.y));
  }

  showLabel(text) {
    const rect = this.dom.getBoundingClientRect();
    this.hoverLabel.style.display = 'block';
    this.hoverLabel.style.left = `${rect.left + ((this.pointer.x + 1) / 2) * rect.width}px`;
    this.hoverLabel.style.top = `${rect.top + ((1 - this.pointer.y) / 2) * rect.height}px`;
    this.hoverLabel.textContent = text;
  }

  cellLabel(x, y) {
    const g = this.town.grid;
    const kind = g.kindAt(x, y);
    // Resource sites and the lake are named first: their cells are plain
    // LOT/WATER tiles with no building record to hang a name off.
    const res = this.town.describeResource ? this.town.describeResource(x, y) : null;
    if (res) return `${res.label} · ${res.resource}`;
    const b = this.town.buildingAt(x, y);
    if (b) return b.name || buildingKindLabel(b);
    if (kind === CELL_KIND.WATER) return 'Lake';
    if (kind === CELL_KIND.ROAD) return `Road · ${g.roadDegree(x, y)} way junction`;
    if (kind === CELL_KIND.PATH) return 'Footway';
    if (kind === CELL_KIND.PARK) return 'Park';
    if (kind === CELL_KIND.PLAZA) return 'Plaza';
    if (kind === CELL_KIND.LOT) return 'Empty lot';
    return g.zone[g.idx(x, y)] ? `${g.zone[g.idx(x, y)]} land` : 'Open land';
  }

  canApply(x, y) {
    const g = this.town.grid;
    // The lake is terrain: nothing builds, plants or demolishes on water.
    if (g.isWater(x, y)) return this.tool === 'select' || this.tool === 'car';
    // A sited resource is its own thing: inspect it or bulldoze it, but do
    // not drop a house or a tree on a wind turbine.
    if (this.town.resources?.ownsCell(x, y)) {
      return this.tool === 'select' || this.tool === 'bulldoze' || this.tool === 'car';
    }
    switch (this.tool) {
      case 'select':
        return true;
      case 'road':
        return g.inBounds(x, y) && g.kindAt(x, y) !== CELL_KIND.ROAD;
      case 'path':
        return (
          g.inBounds(x, y) &&
          g.kindAt(x, y) === CELL_KIND.EMPTY &&
          !this.town.buildingAt(x, y) &&
          !!this.town.roadNeighborOf(x, y)
        );
      case 'house':
      case 'factory':
        return (
          !!this.town.roadNeighborOf(x, y) &&
          !g.isRoad(x, y) &&
          g.kindAt(x, y) !== CELL_KIND.PATH &&
          !this.town.buildingAt(x, y)
        );
      case 'bulldoze':
        return !(
          g.kindAt(x, y) === CELL_KIND.EMPTY && !this.town.buildingAt(x, y)
        );
      default:
        return !g.isRoad(x, y);
    }
  }

  handleClick() {
    if (this.tool === 'select') {
      const agent = this.town.pick(this.raycaster);
      if (agent) {
        this.select(agent);
        return;
      }
      const cell = this.resourceCell() || this.town.cellFromGround(this.raycaster);
      if (cell) {
        const b = this.town.buildingAt(cell.x, cell.y);
        if (b) this.select({ kind: 'building', building: b });
        else this.select({ kind: 'cell', x: cell.x, y: cell.y });
      } else {
        this.select(null);
      }
      return;
    }

    const cell = this.resourceCell() || this.town.cellFromGround(this.raycaster);
    if (!cell) return;
    const { x, y } = cell;
    const t = this.tool;
    let ok = false;

    if (t === 'road') ok = this.town.paintRoad(x, y);
    else if (t === 'path') ok = this.town.paintFootway(x, y);
    else if (t === 'bulldoze') ok = this.town.demolish(x, y);
    else if (t === 'house') ok = !!this.town.placeBuilding(x, y);
    else if (t === 'factory') {
      // Commission whichever works the storehouse is shortest on — the same
      // commission read the council's planner builds from (strained commodity,
      // else the product with the fewest works), so the player tool and
      // BUILD_FACTORY never disagree about what is scarce.
      const ind = this.town.industry;
      const weakest = ind?.commissionProduct?.() || 'lumber';
      const def = FACTORY_TYPES.find((f) => f.product === weakest);
      ok = !!this.placeWorks(x, y, def ? def.id : undefined);
    }
    else if (t === 'park') ok = this.town.setPark(x, y);
    else if (t === 'tree') ok = this.town.addProp(x, y, 'tree');
    else if (t === 'lamp') ok = this.town.addProp(x, y, 'lamp');
    else if (t === 'car') {
      // Buying a vehicle, not conjuring one. The town has a fixed stock derived
      // from its population; this click offers the cheapest one on the market to
      // the town itself, at its real price, paid from the treasury. If the
      // stock is empty or the treasury cannot afford it, nothing happens and
      // the player is told why — which is the whole difference between a fleet
      // and a button that prints cars.
      const registry = this.town.vehicles;
      const market = registry?.idle?.[0];
      if (!market) {
        events.emit('log', { kind: 'event', text: 'No vehicles on the market — the stock is a function of population, so it only grows when the town does.' });
        ok = false;
      } else {
        const price = registry.currentValue(market);
        if (this.town.economy.treasury < price) {
          events.emit('log', { kind: 'event', text: `The treasury cannot afford a ${market.type} (${fmtMoney(price)}) — and nobody else is buying.` });
          ok = false;
        } else {
          // `sellAndDeliver` so a failed delivery refunds — the town is never
          // charged for a vehicle it could not put on the road.
          const bought = registry.sellAndDeliver(market, { sector: 'government', id: 'government' }, null);
          if (bought.ok) {
            ok = true;
          } else {
            events.emit('log', { kind: 'event', text: `Could not buy the ${market.type}: ${bought.reason}.` });
            ok = false;
          }
        }
      }
    } else if (t === 'citizen') ok = !!this.town.pedestrians.spawn(1);

    if (!ok) this.flashHint();
    else if (t !== 'select') {
      events.emit('council', {
        source: 'player',
        actor: 'You',
        action: t === 'house' ? 'BUILD_HOUSE' : t === 'factory' ? 'BUILD_FACTORY' : t.toUpperCase(),
        status: 'done',
        detail: `${PLAYER_WHY[t] || 'you ordered it'} — cell ${x}, ${y}`,
        cost: 0
      });
    }
  }

  /**
   * The player factory tool's placement. Two things the raw
   * `placeBuilding(x, y, ZONE.INDUSTRIAL)` call could not do:
   *
   * 1. The outskirts rule. The council's planner refuses industry inside the
   *    core, and the validator reports it; letting the player drop a sawmill on
   *    the civic square would be a hole in the one rule the game states
   *    everywhere else. Same measured profile, same hard floor.
   * 2. A real footprint. The tool used to place a 1x1 cell, which is smaller
   *    than a single residential plot — a factory that cannot hold a factory.
   *    It now takes the smallest rung of the same lot ladder the council
   *    commissions from, and because the block is anchored on the click we
   *    search the four anchors that keep the clicked cell inside the lot.
   */
  placeWorks(x, y, factoryId) {
    const g = this.town.grid;
    const profile = urbanProfile(g);
    const [cols, rows] = FACTORY_SIZES[0];
    // Cheap pre-checks first, so an obviously illegal click never runs a search.
    if (!onIndustrialGround(profile, x, y)) {
      this.flashHint('Works go on the outskirts — that plot is too central.');
      return null;
    }
    const anchors = cols > 1 || rows > 1
      ? [[x, y], [x - 1, y], [x, y - 1], [x - 1, y - 1]]
      : [[x, y]];
    for (const [ax, ay] of anchors) {
      const mx = ax + (cols - 1) / 2;
      const my = ay + (rows - 1) / 2;
      if (!onIndustrialGround(profile, mx, my)) continue;
      const rec = this.town.placeBuilding(ax, ay, ZONE.INDUSTRIAL, {
        factory: factoryId,
        footprint: { cols, rows }
      });
      if (rec) return rec;
    }
    this.flashHint('No room for a works on that lot — try a bigger one on the rim.');
    return null;
  }

  flashHint(message) {
    const el = $('tool-hint');
    const prev = el.textContent;
    el.textContent = message || 'That spot will not work here.';
    el.style.color = '#ff9b9b';
    clearTimeout(this._hintTimer);
    this._hintTimer = setTimeout(() => {
      el.style.color = '';
      el.textContent = prev;
    }, 1400);
  }

  select(sel) {
    this.selection = sel;
    this.renderInspector();
    this._acc = 1;
  }

  townOverview() {
    const t = this.town;
    const v = t.validation;
    const col = (st) => (st === 'ok' ? '#7ee787' : st === 'warn' ? '#d29922' : '#ff7b72');

    const checkRows = v
      ? v.checks
          .map(
            (c) =>
              `<div class="kv"><span>${c.label}</span><span style="color:${col(c.status)}">${c.detail}</span></div>`
          )
          .join('')
      : '';

    const summary = t.pipelineSummary;
    const fleet = t.traffic.fleetStats();
    const stock = t.stats().vehicleStock;
    const lc = t.lifecycle ? t.lifecycle.stats() : null;
    const ec = t.economy ? t.economy.stats() : null;
    const mb = t.traffic ? t.traffic.mobilityStats() : null;
    const ut = t.utilities ? t.utilities.stats() : null;
    const gr = t.growth ? t.growth.stats() : null;
    const gv = t.governance ? t.governance.stats() : null;
    const rs = t.resources ? t.resources.stats() : null;
    const ind = t.industry ? t.industry.stats() : null;
    const society = t.society ? t.society.stats() : null;
    const transit = t.transport ? t.transport.stats() : null;
    const perimeter = t.perimeter ? t.perimeter.stats() : null;
    const unitStr = Object.entries(fleet.units)
      .map(([k, n]) => `${n} ${k}`)
      .join(' · ');
    return `
      <h2><span class="emo">🏙</span> Town overview</h2>
      <div class="sub">Nothing selected · click a citizen, vehicle, building or road tile.</div>
      ${
        fleet
          ? `<div class="kv grp"><span>🚑 Fleet</span><span>${fleet.emergency} emergency · ${fleet.service} service · ${fleet.civilian} civilian</span></div>
             ${unitStr ? `<div class="kv"><span>Units</span><span>${unitStr}</span></div>` : ''}`
          : ''
      }
      ${
        stock
          ? `<div class="kv grp"><span>🔑 Vehicle stock</span><span>${stock.privateStock} private + ${stock.stateStock} town</span></div>
             <div class="kv"><span>Entitlement</span><span>${stock.privateStock} of ${stock.target} private places for ${stock.population} residents</span></div>
             <div class="kv"><span>On the road</span><span>${stock.inUse} driving · ${stock.onMarket} on sale${stock.leased ? ` · ${stock.leased} rented` : ''}</span></div>
             <div class="kv"><span>Fleet assets</span><span>town ${fmtMoney(stock.stateAssets)} · private ${fmtMoney(stock.privateAssets)}</span></div>
             <div class="kv"><span>Paid for</span><span>treasury ${fmtMoney(stock.treasurySpend)} · households ${fmtMoney(stock.householdSpend)} · rent ${fmtMoney(stock.rentCollected)}</span></div>`
          : ''
      }
      ${
        lc
          ? `<div class="kv grp"><span>👥 Residents</span><span>${lc.population} · median age ${lc.medianAge}</span></div>
             <div class="kv"><span>Stages</span><span>${Object.entries(lc.stages)
               .map(([k, n]) => `${n} ${k}`)
               .join(' · ') || '—'}</span></div>
             <div class="kv"><span>Lifecycle</span><span>+${lc.born} born · ${lc.died} died · +${lc.movedIn} in · ${lc.movedOut} out</span></div>
             <div class="kv"><span>Recent</span><span>${lc.recent.length ? lc.recent[lc.recent.length - 1] : 'quiet'}</span></div>`
          : ''
      }
      ${
        ec
          ? `<div class="kv grp"><span>💰 Economy</span><span>GDP ${fmtMoney(ec.gdp)} annualized · treasury ${fmtMoney(ec.treasury)}</span></div>
             <div class="kv"><span>Businesses</span><span>${ec.businesses} · ${fmtMoney(ec.revenue)}/day</span></div>
             <div class="kv"><span>Daily budget</span><span>${fmtMoney(ec.governmentRevenue)} revenue · ${fmtMoney(ec.governmentExpenditure)} expenditure</span></div>
             <div class="kv"><span>Daily demand</span><span>C ${fmtMoney(ec.consumption)} · I ${fmtMoney(ec.privateFixedInvestment)} · G ${fmtMoney(ec.governmentConsumption + ec.governmentInvestment)}</span></div>
             <div class="kv"><span>Trade/day</span><span>${fmtMoney(ec.exports)} exports · ${fmtMoney(ec.imports)} imports</span></div>
             <div class="kv"><span>Household money</span><span>${fmtMoney(ec.householdCash)} in wallets · ${fmtMoney(ec.householdDeposits)} banked</span></div>
             <div class="kv"><span>Jobs</span><span>${ec.unemployment}% unemployed · avg ${fmtMoney(ec.avgIncome)}</span></div>
              <div class="kv"><span>Land value</span><span>${ec.landValue} avg · warnings ${ec.warnings.length ? ec.warnings.join(', ') : 'none'}</span></div>`
          : ''
      }
      ${
        ind
          ? `<div class="kv grp"><span>🏭 Industry</span><span>${ind.factories} works · ${fmtMoney(ind.revenue)}/day output</span></div>
             <div class="kv"><span>Materials</span><span>${ind.commodities.lumber.stock} lumber · ${ind.commodities.steel.stock} steel · ${ind.commodities.cement.stock} cement</span></div>
             <div class="kv"><span>Goods</span><span>${ind.goods.stock} in store · demand ${ind.goods.demand}/day · factor ×${ind.goods.factor}</span></div>
             <div class="kv"><span>Trade balance</span><span>exports ${fmtMoney(ind.exported)} · imports ${fmtMoney(ind.imported)} · net ${ind.net >= 0 ? '+' : '−'}${fmtMoney(Math.abs(ind.net))}</span></div>`
          : ''
      }
      ${
        gr
          ? `<div class="kv grp"><span>📈 Growth</span><span>${gr.total} project${gr.total === 1 ? '' : 's'} built${gr.active ? ` · ${gr.active} building` : ''}${gr.enabled ? '' : ' · paused'}</span></div>
             <div class="kv"><span>Housing</span><span>${gr.pop} / ${gr.capacity} beds · pressure ${gr.pressure}</span></div>
             ${gr.history.length ? `<div class="kv"><span>Latest</span><span>${gr.history[gr.history.length - 1]}</span></div>` : ''}`
          : ''
      }
      ${
        gv
          ? `<div class="kv grp"><span>🏛 Council</span><span>${esc(gv.providerLabel || gv.providerId || gv.modelUsed || 'LM Studio')}${gv.modelUsed && gv.modelUsed !== gv.providerId ? ` · ${esc(gv.modelUsed)}` : ''} · ${
              gv.available === null ? 'idle' : gv.pending ? 'connected · thinking' : gv.rulesOnly ? `rules only · ${gv.consecutiveFailures} failures` : gv.available ? 'connected' : 'offline · rules fallback'
            }</span></div>
             ${
               gv.last
                 ? `<div class="kv"><span>Decision</span><span>${esc(gv.last.intent)} · ${esc(gv.last.status)}${
                     gv.last.cost ? ` · ${fmtMoney(gv.last.cost)}` : ''
                   }${gv.last.ms != null ? ` · ${gv.last.ms}ms${gv.last.cached ? ' (cached)' : ''}` : ''}</span></div>
                    ${gv.last.detail ? `<div class="kv"><span>Why</span><span>${esc(gv.last.detail)}</span></div>` : ''}`
                 : ''
             }
             ${
               gv.last && gv.last.substituted
                 ? `<div class="kv"><span>Substituted</span><span>${esc(gv.last.substituted.intent || 'the model')} ${esc(
                     gv.last.substituted.status
                   )} — ${esc(gv.last.substituted.detail || '')}</span></div>`
                 : ''
             }
             <div class="kv"><span>Tax rate</span><span>${ec ? ec.taxRate : 100}% · ${gv.cycles} sittings</span></div>`
          : ''
      }
      ${
        society
          ? `<div class="kv grp"><span>⚖ Society</span><span>approval ${Math.round(society.approvalRate * 100)}%${society.mayor ? ` · mayor ${esc(society.mayor)}` : ''}</span></div>
             <div class="kv"><span>Neighbourhoods</span><span>${society.neighbourhoods.length} · ${society.crimes.open} open crime${society.crimes.open === 1 ? '' : 's'} · ${society.crimes.backlog} court backlog</span></div>
             <div class="kv"><span>Mood</span><span>${Math.round(society.mood * 100)}% average · ${society.laws.length} active law${society.laws.length === 1 ? '' : 's'}</span></div>`
          : ''
      }
      ${
        transit
          ? `<div class="kv grp"><span>🚌 Public transport</span><span>${transit.ready ? `${transit.stops} stops · ${transit.fleet} bus${transit.fleet === 1 ? '' : 'es'}` : 'awaiting depot or hub'}</span></div>
             <div class="kv"><span>Ridership</span><span>${transit.dailyRides}/day · coverage ${Math.round(transit.coverage * 100)}%</span></div>`
          : ''
      }
      ${
        perimeter
          ? `<div class="kv grp"><span>🗺 Perimeter</span><span>${perimeter.acquired} acquired tiles · ${perimeter.expansions} expansions</span></div>
             <div class="kv"><span>Frontier</span><span>${perimeter.available} tiles available · next tile $${Math.round(perimeter.nextTileCost).toLocaleString('en-US')}</span></div>`
          : ''
      }
      ${
        mb
          ? `<div class="kv grp"><span>🚗 Mobility</span><span>${mb.moving} moving · ${mb.parked} parked · jam ${Math.round(mb.congestion * 100)}%</span></div>
             <div class="kv"><span>Parking demand (forecast)</span><span>${mb.parkingDemand} / ${mb.parkingSupply} spaces</span></div>
             <div class="kv"><span>Parking observed</span><span>${mb.parkingTaken} taken · ${mb.parkingDenied} turned away</span></div>
             <div class="kv"><span>Trips</span><span>${mb.trips} · avg ${mb.avgTripMin} min</span></div>`
          : ''
      }
      ${
        rs
          ? `<div class="divider"></div><div class="sub emo">💧 Primary resources · ${rs.sites} sites · ${rs.connected} road-connected${rs.staffTotal ? ` · ${rs.staffTotal} on staff` : ''}</div>
             ${Object.keys(rs.types)
               .filter((k) => rs.types[k])
               .map((k) => {
                 const r = rs.types[k];
                 const flow = r.deficit ? ' · below demand' : r.shortage ? ' · exhausted' : '';
                 return `<div class="kv"><span>${r.label} flow</span><span>+${r.production} / −${r.demand} ${r.flowUnit}${flow}</span></div>
                 ${this.bar(`${r.label} store · ${r.level}/${r.capacity} ${r.unit}`, r.percent / 100)}`;
               })
               .join('')}`
          : ''
      }
      ${
        ut && ut.strained && ut.strained.length
          ? `<div class="kv"><span>Utilities</span><span style="color:#d29922">${ut.strained
              .map((k) => ut.types[k].label)
              .join(', ')} over capacity</span></div>`
          : ''
      }
      ${
        v
          ? `<div class="divider"></div><div class="sub emo">✅ Town validator ${v.ok ? '' : `· ${v.errors.length} error(s)`}</div>
             <div class="kv"><span>Checks</span><span style="color:${v.ok ? '#7ee787' : '#ff7b72'}">${v.passed}/${v.total} passed</span></div>
             ${summary ? `<div class="kv"><span>Seeding</span><span>${summary.steps} stages · ${summary.ms} ms${summary.slowest ? ` · slowest ${summary.slowest}` : ''}</span></div>` : ''}
             ${checkRows}`
          : ''
      }
      <div class="divider"></div>
      <div class="empty">Click a citizen, vehicle or building to inspect it.<br />Pick a tool below to modify the town.</div>
    `;
  }

  bar(label, value) {
    const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
    return `<div class="bar-wrap"><div class="bar-label"><span>${label}</span><span>${pct}%</span></div>
      <div class="bar"><i style="width:${pct}%"></i></div></div>`;
  }

  /** Delegated clicks for the pinned Council/Trade buttons and the modal. */
  bindHistoryPanels() {
    $('inspector').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-modal]');
      if (btn) this.openHistory(btn.dataset.modal);
    });
    $('insp-modal').addEventListener('click', (e) => {
      if (e.target.id === 'insp-modal' || e.target.closest('#modal-close')) {
        $('insp-modal').classList.add('hidden');
      }
    });
  }

  /** Fill the history modal — all decisions (who/what/why) or trades. */
  openHistory(kind) {
    const title = $('modal-title');
    const body = $('modal-body');
    $('insp-modal').querySelector('.modal-box')?.classList.remove('settings-modal-box');
    if (kind === 'council') {
      // Unified feed: council motions + player + developer + town auto, newest
      // first. Falls back to governance decisions when the HUD feed is empty
      // (e.g. headless probes with no Hud).
      const feed = window.hud?.feedFull?.length
        ? [...window.hud.feedFull]
        : [...(this.town.governance?.decisions || [])].reverse().map((d) => ({
            day: d.day,
            t: '',
            actor: d.source === 'rules' ? 'Rules' : 'Council',
            action: d.intent,
            status: d.status,
            why: d.detail || '',
            cost: d.cost || 0,
            sub: d.substituted?.intent || null
          }));
      title.textContent = 'All decisions — who did what and why';
      body.innerHTML = feed.length
        ? feed
            .map(
              (d) =>
                `<div class="h-row"><b>Day ${d.day ?? '?'}${d.t ? ` · ${esc(d.t)}` : ''}</b>` +
                `<span class="h-actor">${esc(d.actor || 'Council')}</span> ` +
                `${esc(d.action || d.intent)} · ${esc(d.status)}` +
                `${d.sub ? ` · ↩ ${esc(d.sub)}` : ''}` +
                `${d.cost ? ` ($${Math.round(d.cost).toLocaleString('en-US')})` : ''}` +
                `${d.why || d.detail ? `<br /><span class="h-why">${esc(d.why || d.detail)}</span>` : ''}</div>`
            )
            .join('')
        : '<div class="h-empty">No decisions yet this run.</div>';
    } else if (kind === 'construction') {
      const palette = constructionPalette(this.town);
      title.textContent = 'Construction palette · quoted runway';
      body.innerHTML = Object.entries(palette.groups)
        .map(([family, rows]) => `<div class="h-row"><b>${esc(family)}</b>${rows.map((r) =>
          `<div style="margin-top:5px;opacity:${r.available ? 1 : 0.55}"><span class="h-actor">${esc(r.label)}</span> · ${r.available ? 'available' : esc(r.reason)} · $${Math.round(r.quote.cost).toLocaleString('en-US')} · ${r.quote.labourHours}h<br /><span class="h-why">${esc(r.modules.join(' · '))}</span></div>`
        ).join('')}</div>`)
        .join('') || '<div class="h-empty">No construction blocks match this town.</div>';
    } else {
      const list = [...(this.town.industry?.history || [])].reverse();
      title.textContent = 'Trade history';
      body.innerHTML = list.length
        ? list
            .map((h) => `<div class="h-row"><b>Day ${h.day ?? '?'}</b>${esc(h.text)}</div>`)
            .join('')
        : '<div class="h-empty">No trade activity yet this run.</div>';
    }
    $('insp-modal').classList.remove('hidden');
  }

  renderInspector() {
    const el = $('inspector');
    const s = this.selection;
    if (!s) {
      el.innerHTML = INSPECTOR_TOP +this.townOverview();
      return;
    }

    if (s.kind === 'agent' && s.pick.type === 'citizen') {
      const a = s.pick.agent;
      const p = a.p;
      const t = p.traits;
      const n = p.needs || {};
      const edu = p.education || { level: 'none', field: '—' };
      const rel = p.relationships || { partner: null, children: [], parents: [] };
      const skills = (p.skills || [])
        .map((k) => `${k.id} ${Math.round(k.level * 100)}%`)
        .join(' · ');
      const history = (p.history || [])
        .slice(-3)
        .map((h) => `<div style="margin-bottom:3px">· ${h.text}</div>`)
        .join('');
      el.innerHTML = INSPECTOR_TOP +`
        <h2><span class="emo">🧑</span> ${esc(p.name)}<button class="close" data-close>×</button></h2>
        <div class="sub">${stageLabel(p.age)} · ${Math.round(p.age)} years old · ${p.job.label}</div>
        <div class="kv"><span>Activity</span><span>${p.activity || a.state}</span></div>
        <div class="kv"><span>Where</span><span>${a.statusLabel ? a.statusLabel() : a.state}</span></div>
        <div class="kv"><span>Now</span><span>${scheduleAt(p.schedule || [], this.clock ? this.clock.hour : 12)}</span></div>
        <div class="kv"><span>Family</span><span>${a.household ? `${a.household.surname} household (${a.household.members.length})` : '—'}</span></div>
        <div class="kv"><span>Partner</span><span>${rel.partner || 'Single'}</span></div>
        <div class="kv"><span>Children</span><span>${rel.children && rel.children.length ? rel.children.length : '—'}</span></div>
        <div class="kv"><span>Home</span><span>${a.home ? esc(a.home.name || 'House') : 'unsettled'}</span></div>
        <div class="kv"><span>Workplace</span><span>${a.work ? esc(a.work.name || a.work.kind) : '—'}</span></div>
        <div class="divider"></div>
        <div class="kv"><span>Education</span><span>${EDUCATION_LABEL[edu.level] || edu.level} · ${edu.field}</span></div>
        <div class="kv"><span>Income</span><span>${fmtMoney(p.income)} / yr</span></div>
        <div class="kv"><span>Savings</span><span>${fmtMoney(p.wealth)}</span></div>
        <div class="kv"><span>&nbsp;&nbsp;in wallet</span><span>${fmtMoney(p.cash || 0)}</span></div>
        <div class="kv"><span>&nbsp;&nbsp;at the bank</span><span>${fmtMoney(p.deposits || 0)}</span></div>
        ${p.debt ? `<div class="kv"><span>Debt</span><span>${fmtMoney(p.debt)}</span></div>` : ''}
        <div class="kv"><span>Net worth</span><span>${fmtMoney(this.town.economy ? this.town.economy.netWorthOf(p) : p.netWorth)}</span></div>
        <div class="kv"><span>Intelligence</span><span>${traitLabel(p.intelligence)}</span></div>
        <div class="kv"><span>Skills</span><span>${skills || '—'}</span></div>
        <div class="divider"></div>
        ${this.bar('Health', p.health)}
        ${this.bar('Fullness', n.fullness ?? 1)}
        ${this.bar('Energy', n.energy ?? 1)}
        ${this.bar('Social', n.social ?? 1)}
        ${this.bar('Leisure', n.leisure ?? 1)}
        <div class="divider"></div>
        ${this.bar('Openness', t.openness)}
        ${this.bar('Conscientiousness', t.conscientiousness)}
        ${this.bar('Extraversion', t.extraversion)}
        ${this.bar('Agreeableness', t.agreeableness)}
        ${this.bar('Neuroticism', t.neuroticism)}
        ${this.bar('Mood', a.mood)}
        <div class="divider"></div>
        <div class="kv"><span>Sociability</span><span>${traitLabel(p.sociability)}</span></div>
        <div class="kv"><span>Patience</span><span>${traitLabel(p.patience)}</span></div>
        <div class="kv"><span>Walk pace</span><span>${(p.pace * 100).toFixed(0)}%</span></div>
        <div class="kv"><span>Prefers</span><span>${p.preferences ? p.preferences.transport : '—'}</span></div>
        <div class="kv"><span>Health notes</span><span>${p.conditions && p.conditions.length ? p.conditions.join(', ') : 'none'}</span></div>
        <div class="divider"></div>
        <div style="color:#9da7b3;font-size:11.5px;line-height:1.5">
          <div style="color:#7d8590;text-transform:uppercase;letter-spacing:.14em;font-size:10px;margin-bottom:4px">Recent history</div>
          ${history || '· Nothing yet.'}
          <br />“${p.catchphrase}”<br /><br />Quirk · ${p.quirk}.
        </div>`;
      bindClose(el, this);
      return;
    }

    if (s.kind === 'agent' && s.pick.type === 'vehicle') {
      const a = s.pick.agent;
      const d = a.driverCitizen?.p || a.driver;
      const t = d.traits;
      const onDuty = a.role !== 'civilian';
      const statusLabel =
        a.status === 'enroute' ? 'Responding' : a.status === 'onscene' ? 'At incident'
          : a.status === 'return' ? 'Returning to station' : 'Patrolling';
      const privateStatus = a.fuelStop ? (a.parkTimer > 0 ? 'Refueling' : 'Driving to fuel station')
        : a.awaitingBay ? 'Waiting for parking'
          : a.trip ? 'Driving' : 'Parked';
      el.innerHTML = INSPECTOR_TOP +`
        <h2><span class="emo">🚗</span> ${typeLabel(a.type)}<button class="close" data-close>×</button></h2>
        <div class="sub">${onDuty ? `${roleLabel(a.role)} · ${a.unit} unit` : `Driven by ${d.name}`}</div>
        ${(() => {
          // Title and use are different facts: a rented car shows the renter as
          // the driver and somebody else as the owner, which is the whole point
          // of separating them.
          if (!a.slot || !this.town.vehicles) return '';
          const v = this.town.vehicles.describe(a.slot);
          return `<div class="kv"><span>Owner</span><span>${esc(v.owner)}</span></div>
                  <div class="kv"><span>Used by</span><span>${esc(v.holder)}${v.leased ? ' (renting)' : ''}</span></div>
                  <div class="kv"><span>Value</span><span>${fmtMoney(v.value)} · ${v.age} d old</span></div>
                  <div class="kv"><span>Running cost</span><span>${fmtMoney(v.upkeep)}/day to the owner</span></div>`;
        })()}
        <div class="kv"><span>Speed</span><span>${(a.speed * 3.6).toFixed(0)} km/h</span></div>
        <div class="kv"><span>Route</span><span>${a.idx} / ${a.points.length || '—'} waypoints</span></div>
        <div class="kv"><span>Fuel</span><span>${a.fuel.toFixed(1)} / ${a.fuelCapacity} L</span></div>
        ${
          onDuty
            ? `<div class="kv"><span>Status</span><span>${statusLabel}</span></div>
        <div class="kv"><span>${a.role === 'emergency' ? 'Sirens' : 'Beacon'}</span><span>${
          a.role === 'emergency' ? (a.sirens ? 'On' : 'Off') : 'Amber'
        }</span></div>
        <div class="kv"><span>Station</span><span>${a.homeLabel || 'Depot'}</span></div>`
            : `<div class="kv"><span>Status</span><span>${privateStatus}</span></div>
        <div class="kv"><span>Driver</span><span>${a.driverCitizen?.driving ? esc(d.name) : 'None (parked)'}</span></div>
        <div class="kv"><span>Purpose</span><span>${a.trip ? esc(a.trip.purpose) : 'At destination'}</span></div>
        <div class="kv"><span>Destination</span><span>${a.trip ? esc(a.trip.destination.name || a.trip.destination.kind) : esc(a.driverCitizen?.insideBuilding?.name || 'Home')}</span></div>
        <div class="kv"><span>Occupation</span><span>${esc(d.job?.label || 'Resident')}</span></div>`
        }
        <div class="divider"></div>
        ${this.bar('Extraversion', t.extraversion)}
        ${this.bar('Conscientiousness', t.conscientiousness)}
        ${this.bar('Neuroticism', t.neuroticism)}
        <div class="divider"></div>
        <div style="color:#9da7b3;font-size:11.5px;line-height:1.5">“${d.catchphrase}”</div>`;
      bindClose(el, this);
      return;
    }

    if (s.kind === 'building') {
      const b = s.building;
      const residents = this.town.residentsOf(b);
      const present = this.town.pedestrians.citizens.filter((c) => c.indoors && c.insideBuilding === b);
      const staff = this.town.pedestrians.citizens.filter((c) => c.work === b && !present.includes(c));
      const label = buildingKindLabel(b);
      const roleCounts = {};
      for (const p of b.house.parts || []) roleCounts[p.role] = (roleCounts[p.role] || 0) + 1;
      const roleTags = Object.entries(roleCounts)
        .sort((a, c) => c[1] - a[1])
        .map(([r, n]) => `<span class="tag">${r} ${n}</span>`)
        .join('');
      const moduleKinds = [...new Set((b.modules || []).map((m) => m.kind))];
      const moduleTags = moduleKinds.map((k) => `<span class="tag">${k}</span>`).join('');
      const biz = this.town.economy ? this.town.economy.describeBusiness(b) : null;
      const works =
        b.kind === 'factory' && this.town.industry ? this.town.industry.describe(b) : null;
      const land = this.town.economy ? this.town.economy.landValueAt(b.cell[0], b.cell[1]) : null;
      // Civic facilities show their KIND's load (demand vs total capacity).
      const load = b.kind === 'civic' && b.capacityKind ? buildingLoad(this.town, b) : null;
      el.innerHTML = INSPECTOR_TOP +`
        <h2><span class="emo">🏗</span> ${esc(b.name || label)}<button class="close" data-close>×</button></h2>
        <div class="sub">${label} · ${b.zone} zone</div>
        <div class="kv"><span>Floors</span><span>${b.floors}</span></div>
        <div class="kv"><span>Style</span><span>${b.style}</span></div>
        <div class="kv"><span>Roof</span><span>${b.house.roofType}</span></div>
        <div class="kv"><span>Footprint</span><span>${b.size.w.toFixed(1)} × ${b.size.d.toFixed(1)} m</span></div>
        <div class="kv"><span>Cell</span><span>${b.cell[0]}, ${b.cell[1]}</span></div>
        ${b.owner ? `<div class="kv"><span>Owner</span><span>${b.owner === 'state' ? 'Town-owned' : 'Private'}</span></div>` : ''}
        ${b.purpose ? `<div class="kv"><span>Purpose</span><span>${b.purpose}${b.budget ? ` · tier ${b.budget}` : ''}</span></div>` : ''}
        ${b.blockId ? `<div class="kv"><span>Construction block</span><span>${esc(b.blockId)}</span></div>` : ''}
        ${b.constructionFlags ? `<div class="kv"><span>Climate/access</span><span>${[
          b.constructionFlags.accessible ? 'Accessible' : null,
          b.constructionFlags.solar ? 'Solar' : null,
          b.constructionFlags.greenRoof ? 'Green roof' : null,
          b.constructionFlags.balcony ? 'Balcony' : null
        ].filter(Boolean).join(' · ') || 'Base shell'}</span></div>` : ''}
        ${b.capacity ? `<div class="kv"><span>Capacity</span><span>${b.capacity} ${b.capacityKind || (b.purpose === 'residential' ? 'residents' : 'people')}</span></div>` : ''}
        ${load !== null && load !== undefined ? `<div class="kv"><span>Load</span><span>${Math.round(load * 100)}%${load > 0.85 ? ' · over capacity' : ''}</span></div>` : ''}
        ${land !== null ? `<div class="kv"><span>Land value</span><span>${Math.round(land * 100)}/100</span></div>` : ''}
        ${
          biz
            ? `<div class="divider"></div><div class="sub">Business</div>
               <div class="kv"><span>Staff</span><span>${biz.employees}${biz.staffNeed ? ` / ${biz.staffNeed}` : ''}</span></div>
               ${
                 // Phase 20 — an office has no customers: it sells desks, not
                 // passing trade, so a "Customers/day 0" row would read as a
                 // business in trouble when it is working.
                 biz.type === 'office'
                   ? `<div class="kv"><span>Desks</span><span>${b.capacity || 0} · earns on staffing, not footfall</span></div>`
                   : `<div class="kv"><span>Customers/day</span><span>${biz.customers}</span></div>`
               }
               <div class="kv"><span>Revenue/day</span><span>${fmtMoney(biz.revenue)}</span></div>
               <div class="kv"><span>Profit/day</span><span>${fmtMoney(biz.profit)}</span></div>
               <div class="kv"><span>Rent</span><span>${fmtMoney(biz.rent)} / yr</span></div>`
            : ''
        }
        ${
          works
            ? `<div class="divider"></div><div class="sub">Works</div>
               <div class="kv"><span>Type</span><span>${works.label}</span></div>
               <div class="kv"><span>Output</span><span>${works.rate} ${works.productLabel.toLowerCase()}/day</span></div>
               <div class="kv"><span>Storehouse</span><span>${works.stock} / ${works.capacity}</span></div>
               <div class="kv"><span>Worth</span><span>${fmtMoney(works.worth)}/day</span></div>`
            : ''
        }
        ${b.parcelId !== null && b.parcelId !== undefined ? `<div class="kv"><span>Parcel</span><span>#${b.parcelId}${b.setback !== undefined ? ` · ${b.setback.toFixed(2)} m setback` : ''}</span></div>` : ''}
        ${roleTags ? `<div class="divider"></div><div class="sub">Building kit · parts</div>${roleTags}` : ''}
        ${moduleTags ? `<div class="divider"></div><div class="sub">Functional modules</div>${moduleTags}` : ''}
        ${b.household ? `<div class="divider"></div><div class="sub">Household</div>` : ''}
        ${b.household ? `<div class="kv"><span>${b.household.surname}</span><span>${b.household.members.length} members</span></div>` : ''}
        ${residents.length ? `<div class="divider"></div><div class="sub">Residents</div>` : ''}
        ${residents
          .map((r) => `<div class="kv"><span>${r.p.name}</span><span>${r.statusLabel ? r.statusLabel() : r.state}</span></div>`)
          .join('')}
        ${present.length ? `<div class="divider"></div><div class="sub">Inside now · ${present.length}</div>` : ''}
        ${present
          .map((r) => `<div class="kv"><span>${r.p.name}</span><span>Inside · ${r.p.job.label}</span></div>`)
          .join('')}
        ${staff.length ? `<div class="divider"></div><div class="sub">Staff</div>` : ''}
        ${staff
          .map((r) => `<div class="kv"><span>${r.p.name}</span><span>${r.statusLabel ? r.statusLabel() : r.state}</span></div>`)
          .join('')}`;
      bindClose(el, this);
      return;
    }

    if (s.kind === 'cell') {
      const g = this.town.grid;
      const kind = g.kindAt(s.x, s.y);
      const zone = g.zone[g.idx(s.x, s.y)];
      const names = ['Open land', 'Road', 'Lot', 'Park', 'Water', 'Plaza', 'Footway'];
      const info = this.town.roadKit.cellInfo?.get(`${s.x},${s.y}`);
      const graph = this.town.roadGraph?.describe(s.x, s.y) || null;
      const parcel = this.town.parcels?.describe(s.x, s.y) || null;
        const util = this.town.describeUtility ? this.town.describeUtility(s.x, s.y) : null;
        const res = this.town.describeResource ? this.town.describeResource(s.x, s.y) : null;
      const pub = this.town.publicSpaceAt ? this.town.publicSpaceAt(s.x, s.y) : null;
      const feature = g.featureAt ? g.featureAt(s.x, s.y) : ROAD_FEATURE.NONE;
      const featureName = feature && feature !== ROAD_FEATURE.NONE
        ? ROAD_FEATURE_LABEL[feature]
        : null;
      el.innerHTML = INSPECTOR_TOP +`
        <h2><span class="emo">${res ? `🗺` : `🏳`}</span> ${res ? `${res.label}` : `Cell ${s.x}, ${s.y}`}<button class="close" data-close>×</button></h2>
        <div class="sub">${res ? `${res.resource} · primary resource` : `${names[kind] || 'Unknown'}${info?.street ? ` · ${info.street}` : ''}`}</div>
        ${
          res
            ? `<div class="kv"><span>${res.storage ? 'Storage' : 'Yield'}</span><span>${res.storage ? `${res.storage} ${res.storageUnit}` : `${res.output} ${res.outputUnit}`}</span></div>
        <div class="kv"><span>Access</span><span>${res.connected ? 'Road connected' : 'Cut off from the network'}</span></div>
        <div class="kv"><span>Reserves</span><span>${res.percent}%</span></div>
        ${res.tier ? `<div class="kv"><span>Tier</span><span>${esc(res.tier)} · level ${res.level} of 3 · ${res.yard} cell yard${res.crowded ? ' · no room to grow' : ''}</span></div>` : ''}
        ${
          res.crewLabel
            ? `<div class="kv"><span>Crew</span><span>${res.crew ? `${res.crew}/${res.crewNeed} ${res.crewLabel}${res.crew === 1 ? '' : 's'}` : 'unstaffed'}</span></div>`
            : ''
        }
        <div class="divider"></div>`
            : ''
        }
        <div class="kv"><span>Zone</span><span>${zone || 'unzoned'}</span></div>
        ${kind === CELL_KIND.ROAD ? `<div class="kv"><span>Junction</span><span>${g.roadDegree(s.x, s.y)} way</span></div>` : ''}
        ${featureName ? `<div class="kv"><span>Structure</span><span>${featureName}</span></div>` : ''}
        ${info?.section ? `<div class="kv"><span>Section</span><span>${info.section}</span></div>` : ''}
        ${graph?.node ? `<div class="kv"><span>Graph node</span><span>${graph.node.kind} · ${graph.node.links} link(s)</span></div>` : ''}
        ${graph?.edge ? `<div class="kv"><span>Graph edge</span><span>#${graph.edge.id} · ${graph.edge.length.toFixed(0)} m · ${graph.edge.lanes} lane${graph.edge.lanes === 1 ? '' : 's'} · ${graph.edge.width.toFixed(2)} m</span></div>` : ''}
        ${parcel ? `<div class="divider"></div><div class="sub">Parcel #${parcel.id} · ${parcel.label}</div>
        <div class="kv"><span>Plot</span><span>${parcel.cells} cell${parcel.cells === 1 ? '' : 's'} · ${parcel.area} m²${parcel.subdivided ? ' · subdivided' : ''}</span></div>
        <div class="kv"><span>Frontage</span><span>${parcel.frontage} side${parcel.frontage === 1 ? '' : 's'}${parcel.street ? ` · ${parcel.street}` : ''}</span></div>
        <div class="kv"><span>Setback</span><span>${parcel.setback.toFixed(2)} m</span></div>
        <div class="kv"><span>Use</span><span>${parcel.use}${parcel.buildable ? '' : ' · not buildable'}</span></div>
        ${parcel.driveway || parcel.parking || parcel.courtyard || parcel.garden || parcel.publicSpace ? `<div class="kv"><span>Features</span><span>${[
          parcel.driveway ? 'Driveway' : null,
          parcel.parking ? 'Parking' : null,
          parcel.courtyard ? 'Courtyard' : null,
          parcel.garden ? 'Garden' : null,
          parcel.publicSpace ? 'Public space' : null
        ].filter(Boolean).join(' · ')}</span></div>` : ''}` : ''}
        ${pub ? `<div class="kv"><span>Public space</span><span>${pub}</span></div>` : ''}
        ${util ? `<div class="divider"></div><div class="sub">${util.label} · ${util.utility}</div>
        <div class="kv"><span>Capacity</span><span>${util.capacity} ${util.unit}</span></div>
        <div class="kv"><span>Demand</span><span>${util.demand} ${util.unit}${util.saturated ? ' · over capacity' : ''}</span></div>
        <div class="kv"><span>Coverage</span><span>${util.coverage}%</span></div>` : ''}
        ${info?.names?.length ? `<div class="divider"></div><div class="sub">Road components</div>${info.names.map((n) => `<span class="tag">${n}</span>`).join('')}` : ''}
        <div class="divider"></div>
        <div class="empty">Use the construction kit to change this tile.</div>`;
      bindClose(el, this);
      return;
    }

    if (s.kind === 'roadinfo') {
      el.innerHTML = INSPECTOR_TOP +`<div class="empty">Road tile.</div>`;
      bindClose(el, this);
    }
  }

  update(dt) {
    this._acc += dt;
    if (this._acc <= 0.5) return;
    this._acc = 0;
    // Refresh BOTH the selection panel and the idle town overview: with no
    // selection nothing else ever re-rendered the overview, so its numbers
    // (population, housing, treasury, lifecycle) froze at load-time values
    // while the HUD kept moving — they visibly disagreed.
    const el = $('inspector');
    const top = el.scrollTop;
    this.renderInspector();
    el.scrollTop = top;
  }
}

function bindClose(el, self) {
  const btn = el.querySelector('[data-close]');
  if (btn) btn.addEventListener('click', () => self.select(null));
}

export { ZONE };
