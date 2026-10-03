import cabinetConfig from '../data/cabinet.json' with { type: 'json' };
import { MayorSystem } from './mayor.js';
import { actionFor } from './actionRegistry.js';

const clamp = (value, min, max) => Math.max(min, Math.min(max, Math.round(Number(value) || min)));

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
    this.lastReview = null;
    this.lastExecution = [];
    this.mayor.reset();
  }

  departmentForIntent(intent, index = 0) {
    const match = this.departments.find((department) => department.intents.includes(intent));
    return match || this.departments[index % Math.max(1, this.departments.length)] || { id: 'council', label: 'Council', remit: '', intents: [] };
  }

  prompt() {
    const departments = this.departments.map((department) =>
      `${department.id}=${department.label}`
    ).join(' · ');
    return [
      'CABINET MODE overrides the common one-action reply: return one JSON object, motions=[].',
      `Include at most ${this.motionsPerSitting} motions, normally one per department; each has department, canonical intent, reason, priority 0..1, and optional params.`,
      'Use the existing intent vocabulary and report evidence. The Mayor approves or rejects; do not claim execution or invent coordinates, budgets, IDs, or actions.',
      departments
    ].join('\n');
  }

  parse(text) {
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
    return rows.slice(0, Math.max(12, this.motionsPerSitting + this.departments.length)).map((row, index) => {
      const object = row && typeof row === 'object' ? row : { text: row };
      const intentText = object.intent || object.action || object.code || object.text || '';
      const raw = /^\s*(?:INTENT|ACTION|DECISION)\s*:/i.test(String(intentText))
        ? String(intentText)
        : `INTENT: ${String(intentText)}`;
      const result = parser(raw);
      const declaredDepartment = this.departments.find((item) => item.id === object.department);
      const department = declaredDepartment || this.departmentForIntent(result.intent, index);
      const params = object.params && typeof object.params === 'object' ? object.params : {};
      const fullRaw = paramsText(params) ? `${raw} ${paramsText(params)}` : raw;
      const finalResult = paramsText(params) ? parser(fullRaw) : result;
      const ownershipValid = !declaredDepartment || finalResult.intent === 'NO_ACTION' || declaredDepartment.intents.includes(finalResult.intent);
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
        key: `${finalResult.intent || 'UNPARSED'}|${fullRaw.replace(/^INTENT:\s*/i, '').trim().toUpperCase()}`
      };
    });
  }

  stats() {
    return {
      enabled: this.enabled,
      motionsPerSitting: this.motionsPerSitting,
      departments: this.departments.map(({ id, label, intents }) => ({ id, label, intents: [...intents] })),
      mayor: this.mayor.stats(),
      lastSittingId: this.lastSittingId,
      lastMotions: this.lastMotions.map((motion) => ({ ...motion })),
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
}
