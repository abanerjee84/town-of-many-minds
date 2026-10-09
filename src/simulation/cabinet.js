import cabinetConfig from '../data/cabinet.json' with { type: 'json' };
import { MayorSystem } from './mayor.js';
import { actionFor } from './actionRegistry.js';

const clamp = (value, min, max) => Math.max(min, Math.min(max, Math.round(Number(value) || min)));

// A motion is long-term only when it deliberately observes, designs, or
// changes the town's future direction. Everything else remains eligible as an
// immediate response when the report names it as a measured priority. This is
// a mix guard, not a hidden action chooser: it only rearranges candidate IDs
// already returned by the ministers and synthesis chamber.
const LONG_TERM_INTENTS = new Set([
  'NO_ACTION', 'IMAGINE_ARCHETYPE', 'BUILD_LANDMARK', 'EXPAND_LANDMARK',
  'HOST_EVENT', 'ENACT_SCHEME', 'END_SCHEME', 'PASS_LAW', 'REPEAL_LAW',
  'FUND_INNOVATION', 'STUDY_ECONOMY', 'STUDY_DEMOGRAPHICS', 'STUDY_INCIDENTS',
  'STUDY_ROAD', 'STUDY_TRAFFIC'
]);

const intentHead = (value) => String(value || '').trim().split(/\s+/)[0].toUpperCase();

function extractJson(text) {
  const raw = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  for (const candidate of [raw, raw.match(/\{[\s\S]*\}/)?.[0], raw.match(/\[[\s\S]*\]/)?.[0]]) {
    if (!candidate) continue;
    try { return JSON.parse(candidate); } catch { /* try the next shape */ }
  }
  return null;
}

function paramsText(params = {}) {
  return Object.entries(params)
    .filter(([key, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => `${key}=${typeof value === 'string' && /\s/.test(value) ? JSON.stringify(value) : value}`)
    .join(' ');
}

export class CabinetSystem {
  constructor(governance, options = {}) {
    this.governance = governance;
    this.config = options.config || cabinetConfig;
    this.motionsPerSitting = clamp(options.motionsPerSitting ?? this.config.motionsPerSitting, 1, 12);
    const mix = options.priorityMix || this.config.priorityMix || {};
    const immediateShare = Number(mix.immediateShare);
    const longTermShare = Number(mix.longTermShare);
    this.priorityMix = Object.freeze({
      immediateShare: Number.isFinite(immediateShare) ? Math.max(0, Math.min(1, immediateShare)) : 0.7,
      longTermShare: Number.isFinite(longTermShare) ? Math.max(0, Math.min(1, longTermShare)) : 0.3
    });
    this.departments = (this.config.departments || []).map((department) => ({
      ...department,
      intents: [...(department.intents || [])].filter((intent) => actionFor(intent))
    }));
    this.mayor = new MayorSystem(this.config.mayor);
    this.enabled = options.enabled !== false;
    this.reset();
  }

  reset() {
    this.lastReply = '';
    this.lastSittingId = null;
    this.lastMotions = [];
    this.lastBoundaryViolations = [];
    this.lastSpecViolations = [];
    this.lastCouncil = null;
    this.lastReview = null;
    this.lastExecution = [];
    this.mayor.reset();
  }

  departmentForIntent(intent, index = 0) {
    const match = this.departments.find((department) => department.intents.includes(intent));
    return match || this.departments[index % Math.max(1, this.departments.length)] || { id: 'council', label: 'Council', remit: '', intents: [] };
  }

  prompt() {
    return [
      'CABINET MODE: return one JSON object {"motions":[]}; do not use the legacy one-line format unless the provider cannot emit JSON.',
      `Submit at most ${this.motionsPerSitting} motions, normally one per department. Each motion has department, canonical intent, reason, priority 0..1, emergency when measured, and optional parser params.`,
      'Typed build intents must carry their catalogue parameter: BUILD_LANDMARK requires params.type=<landmark id>, BUILD_FACTORY requires params.type=<factory id>, BUILD_CIVIC/BUILD_TRANSIT require their facility when the report names one, and IMAGINE_ARCHETYPE requires params.block=<catalogue id>. Never submit a bare typed-build intent; choose NO_ACTION when the report does not identify a legal catalogue row.',
      `Use a ${Math.round(this.priorityMix.immediateShare * 100)}/${Math.round(this.priorityMix.longTermShare * 100)} split: address listed Priority/mandatory evidence first, and use the remaining share for defensible long-term capacity or vision.`,
      'Use only the report evidence and the named department remit. The Mayor approves or rejects; do not claim execution or invent coordinates, budgets, IDs, or actions.',
      'Industry demand priorities use identical rules for every factory product. Restore staff, inputs or utilities before duplicating idle capacity; bridge in-flight capacity, then expand or commission the named product. Trace missing inputs first. Propose only your owned remedy; land owns UPGRADE_BUILDING/WING, treasury owns BUILD_FACTORY/trade. Private investments require independent viability and acceptance.'
    ].join('\n');
  }

  /**
   * One independent system message per minister. Keeping these prompts in the
   * data file lets a benchmark swap a department's decision frame without
   * changing parsing, Mayor review, or execution.
   */
  systemPrompts() {
    return this.departments.map((department) => {
      const focus = department.systemPrompt || department.remit || 'Use the report evidence for this department.';
      const intents = department.intents.join('|');
      return [
        `CABINET MINISTER ${department.id} — ${department.label}.`,
        focus,
        `Own intents: ${intents}. Submit at most one motion for this department; use another department for another remit. Typed builds must include the exact catalogue parameter from Feasible now: BUILD_LANDMARK needs params.type=<id>, BUILD_FACTORY needs params.type=<id>, BUILD_CIVIC/BUILD_TRANSIT need params.facility when applicable, and IMAGINE_ARCHETYPE needs params.block=<id>. A bare typed-build intent is invalid; return NO_ACTION when no legal row is named. When this department owns a listed Priority or mandatory remedy, choose it before a study, scheme, design, or other long-term option. The sitting target is ${Math.round(this.priorityMix.immediateShare * 100)}% immediate evidence and ${Math.round(this.priorityMix.longTermShare * 100)}% long-term vision across the Cabinet.`
      ].join(' ');
    });
  }

  parse(text, options = {}) {
    const parsed = extractJson(text);
    let rows = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.motions) ? parsed.motions : null;
    if (!rows) {
      rows = String(text || '').split(/\r?\n/).filter((line) => /\b(?:INTENT|ACTION|DECISION)\s*:/i.test(line));
      if (!rows.length) rows = [...String(text || '').matchAll(/"intent"\s*:\s*"([A-Z][A-Z0-9_]*)"/gi)].map((match) => match[1]);
      if (!rows.length && String(text || '').trim()) rows = [String(text).trim()];
    }
    const parser = this.governance.parseIntent;
    // Keep a small overflow window so the Mayor can explicitly defer a
    // provider that ignores the sitting cap instead of silently dropping its
    // sixth proposal.
    const defaultDepartment = this.departments.find((item) => item.id === options.departmentId) || null;
    const maxMotions = Number.isFinite(Number(options.maxMotions))
      ? Math.max(1, Number(options.maxMotions))
      : Math.max(12, this.motionsPerSitting + this.departments.length);
    return rows.slice(0, maxMotions).map((row, index) => {
      const object = row && typeof row === 'object' ? row : { text: row };
      const intentText = object.intent || object.action || object.code || object.text || '';
      const raw = /^\s*(?:INTENT|ACTION|DECISION)\s*:/i.test(String(intentText))
        ? String(intentText)
        : `INTENT: ${String(intentText)}`;
      const result = parser(raw);
      const declaredDepartment = this.departments.find((item) => item.id === object.department);
      const department = declaredDepartment || defaultDepartment || this.departmentForIntent(result.intent, index);
      const params = object.params && typeof object.params === 'object' ? object.params : {};
      const fullRaw = paramsText(params) ? `${raw} ${paramsText(params)}` : raw;
      const finalResult = paramsText(params) ? parser(fullRaw) : result;
      const declaredDepartmentMatches = !defaultDepartment || !declaredDepartment || declaredDepartment.id === defaultDepartment.id;
      const ownershipValid = defaultDepartment
        ? declaredDepartmentMatches && (finalResult.intent === 'NO_ACTION' || defaultDepartment.intents.includes(finalResult.intent))
        : (!declaredDepartment || finalResult.intent === 'NO_ACTION' || declaredDepartment.intents.includes(finalResult.intent));
      const specIssues = Array.isArray(finalResult.params?.issues) ? finalResult.params.issues : [];
      return {
        id: `motion-${index + 1}`,
        index,
        department: department.id,
        departmentLabel: department.label,
        intent: finalResult.intent,
        params: finalResult.params || {},
        raw: fullRaw,
        reason: String(object.reason || object.why || '').slice(0, 240),
        priority: Math.max(0, Math.min(1, Number(object.priority) || 0)),
        emergency: Boolean(object.emergency),
        ownershipValid,
        ownershipReason: ownershipValid ? '' : `${finalResult.intent || 'motion'} is outside ${department.label}`,
        specValid: specIssues.length === 0,
        specReason: specIssues.join('; '),
        key: `${finalResult.intent || 'UNPARSED'}|${fullRaw.replace(/^INTENT:\s*/i, '').trim().toUpperCase()}`
      };
    });
  }

  /**
   * Parse the sixth-call Council synthesis envelope. The Council may rank
   * only motions already submitted by a minister; it cannot invent a new
   * intent, department, coordinate, budget, or catalogue id at this stage.
   */
  parseCouncil(text, candidates = []) {
    const parsed = extractJson(text);
    const hasEnvelope = Boolean(parsed && (Array.isArray(parsed?.selected) || Array.isArray(parsed?.motions) || Array.isArray(parsed)));
    const rows = Array.isArray(parsed?.selected)
      ? parsed.selected
      : Array.isArray(parsed?.motions)
        ? parsed.motions
        : Array.isArray(parsed)
          ? parsed
          : [];
    const byId = new Map(candidates.map((motion) => [motion.id, motion]));
    const selected = [];
    const invalid = [];
    const seen = new Set();
    rows.forEach((row) => {
      const id = typeof row === 'string' ? row : row?.id || row?.motionId;
      const candidate = byId.get(id);
      if (!candidate || seen.has(candidate.id)) {
        invalid.push(id || 'missing motion id');
        return;
      }
      seen.add(candidate.id);
      selected.push({
        ...candidate,
        reason: String(row?.reason || candidate.reason || '').slice(0, 240),
        priority: Math.max(0, Math.min(1, Number(row?.priority ?? candidate.priority) || 0)),
        councilSelected: true
      });
    });
    const valid = hasEnvelope && (!rows.length || selected.length > 0);
    return { valid, selected, invalid, raw: String(text || '').slice(0, 240) };
  }

  stats() {
    return {
      enabled: this.enabled,
      motionsPerSitting: this.motionsPerSitting,
      priorityMix: { ...this.priorityMix },
      departments: this.departments.map(({ id, label, intents }) => ({ id, label, intents: [...intents] })),
      systemPrompts: this.systemPrompts().map((prompt, index) => ({
        department: this.departments[index]?.id || null,
        prompt
      })),
      mayor: this.mayor.stats(),
      lastSittingId: this.lastSittingId,
      lastMotions: this.lastMotions.map((motion) => ({ ...motion })),
      lastBoundaryViolations: this.lastBoundaryViolations.map((motion) => ({
        id: motion.id,
        department: motion.department,
        departmentLabel: motion.departmentLabel,
        intent: motion.intent,
        reason: motion.ownershipReason
      })),
      lastSpecViolations: this.lastSpecViolations.map((motion) => ({
        id: motion.id,
        department: motion.department,
        departmentLabel: motion.departmentLabel,
        intent: motion.intent,
        reason: motion.specReason || 'invalid typed-build parameters'
      })),
      lastCouncil: this.lastCouncil ? {
        status: this.lastCouncil.status,
        selected: (this.lastCouncil.selected || []).map((motion) => ({
          id: motion.id,
          department: motion.department,
          intent: motion.intent,
          priority: motion.priority,
          reason: motion.reason
        })),
        invalid: [...(this.lastCouncil.invalid || [])],
        valid: this.lastCouncil.valid !== false,
        fallback: !!this.lastCouncil.fallback,
        mixChanges: [...(this.lastCouncil.mixChanges || [])]
      } : null,
      lastReview: this.lastReview ? { ...this.lastReview } : null,
      lastExecution: this.lastExecution.map((decision) => ({
        id: decision.motionId,
        department: decision.department,
        intent: decision.intent,
        status: decision.status,
        mayor: decision.mayor
      }))
    };
  }

  /**
   * Mark a motion as immediate when it is one of the planner's named Priority
   * rows, an emergency, or an action that is inherently operational. The
   * remaining proposals are the long-term/vision share. This is intentionally
   * based on candidate evidence, never on a new intent or an invented plan.
   */
  isImmediate(motion, priorityIntents = []) {
    const priorities = new Set(priorityIntents.map(intentHead));
    const intent = intentHead(motion?.intent);
    return Boolean(motion?.emergency) || priorities.has(intent) || !LONG_TERM_INTENTS.has(intent);
  }

  /**
   * Keep the final Council slate close to the configured 70/30 evidence mix.
   * The synthesis model still chooses the candidates; this guard only fills a
   * missing immediate slot or replaces an excess long-term candidate with a
   * stronger admitted candidate. That prevents a sitting from spending all
   * its approvals on studies, schemes, or designs while a Priority row waits.
   */
  enforcePriorityMix(selected = [], candidates = [], priorityIntents = []) {
    const limit = Math.min(this.motionsPerSitting, candidates.length);
    const byId = new Map(candidates.map((motion) => [motion.id, motion]));
    const chosen = [];
    const seen = new Set();
    for (const motion of selected) {
      const candidate = byId.get(motion?.id) || motion;
      if (!candidate?.id || seen.has(candidate.id)) continue;
      seen.add(candidate.id);
      chosen.push(candidate);
      if (chosen.length >= limit) break;
    }
    const rank = (a, b) =>
      (Number(b.priority) || 0) - (Number(a.priority) || 0) ||
      (Number(a.index) || 0) - (Number(b.index) || 0);
    const available = candidates.filter((motion) => !seen.has(motion.id));
    const immediate = available.filter((motion) => this.isImmediate(motion, priorityIntents)).sort(rank);
    const immediateCount = () => chosen.filter((motion) => this.isImmediate(motion, priorityIntents)).length;
    const changes = [];

    // If synthesis returned no slate despite admitted candidates, one evidence
    // backed motion must still reach the Mayor. This keeps a valid sitting from
    // appearing as a silent three-day hold.
    if (!chosen.length && candidates.length) {
      const first = [...candidates].sort((a, b) => {
        const ai = this.isImmediate(a, priorityIntents) ? 1 : 0;
        const bi = this.isImmediate(b, priorityIntents) ? 1 : 0;
        return bi - ai || rank(a, b);
      })[0];
      if (first) {
        chosen.push(first);
        seen.add(first.id);
        changes.push(`added ${first.id} to avoid an empty admitted slate`);
      }
    }

    // Replace the weakest long-term selection first. If there is no such row,
    // append the immediate candidate while the approval cap still permits it.
    while (immediateCount() < Math.min(limit, Math.ceil(chosen.length * this.priorityMix.immediateShare))) {
      const next = immediate.shift();
      if (!next) break;
      const replaceAt = chosen
        .map((motion, index) => ({ motion, index }))
        .filter(({ motion }) => !this.isImmediate(motion, priorityIntents))
        .sort((a, b) => rank(a.motion, b.motion))[0]?.index;
      if (replaceAt == null) {
        if (chosen.length >= limit) break;
        chosen.push(next);
      } else {
        const replaced = chosen[replaceAt];
        chosen[replaceAt] = next;
        seen.delete(replaced.id);
      }
      seen.add(next.id);
      changes.push(`promoted ${next.id} into the immediate share`);
    }
    return { selected: chosen.slice(0, limit), changes };
  }
}
