const OPTIONAL_POLICY_INTENTS = new Set(['ENACT_SCHEME', 'PASS_LAW', 'HOST_EVENT']);

/**
 * The Mayor is the final public approval gate for Cabinet motions. This module
 * deliberately does not invent a second action vocabulary or bypass the
 * Council planner: it accepts unique, parseable motions and leaves feasibility
 * and accounting to GovernanceSystem.enact().
 */
export class MayorSystem {
  constructor(config = {}) {
    this.label = config.label || 'Mayor';
    this.maxApprovals = Math.max(1, Math.min(12, Math.round(Number(config.maxApprovals) || 5)));
    this.emergencyFirst = config.emergencyFirst !== false;
    this.reset();
  }

  reset() {
    this.lastReview = null;
    this.reviewCount = 0;
  }

  review(motions = [], context = {}) {
    const required = context.requiredAction?.intent || null;
    const priorityIntents = Array.isArray(context.priorityIntents) ? context.priorityIntents : [];
    const approved = [];
    const rejected = [];
    const deferred = [];
    const seen = new Set();
    const seenDepartments = new Set();
    const ordered = [...motions].sort((a, b) => {
      if (this.emergencyFirst && Boolean(a.emergency) !== Boolean(b.emergency)) return a.emergency ? -1 : 1;
      return (Number(b.priority) || 0) - (Number(a.priority) || 0) || (a.index || 0) - (b.index || 0);
    });

    for (const motion of ordered) {
      const key = motion.key || motion.intent || `motion-${motion.index}`;
      const reason = motion.reason || '';
      if (!motion.intent) {
        rejected.push({ ...motion, status: 'mayor_rejected', mayorReason: 'no parseable intent' });
        continue;
      }
      if (motion.ownershipValid === false) {
        rejected.push({ ...motion, status: 'mayor_rejected', mayorReason: motion.ownershipReason || 'intent is outside this department remit' });
        continue;
      }
      if (seen.has(key)) {
        rejected.push({ ...motion, status: 'mayor_rejected', mayorReason: 'duplicate motion in this sitting' });
        continue;
      }
      seen.add(key);
      if (motion.department && seenDepartments.has(motion.department)) {
        rejected.push({ ...motion, status: 'mayor_rejected', mayorReason: 'department already submitted a motion this sitting' });
        continue;
      }
      if (required && motion.intent !== required) {
        deferred.push({ ...motion, status: 'mayor_deferred', mayorReason: `mandatory remedy ${required} takes priority` });
        continue;
      }
      if (!required && priorityIntents.length && OPTIONAL_POLICY_INTENTS.has(motion.intent) && !motion.emergency) {
        deferred.push({
          ...motion,
          status: 'mayor_deferred',
          mayorReason: `measured build priority takes precedence over optional ${motion.intent}`
        });
        continue;
      }
      if (approved.length >= this.maxApprovals) {
        deferred.push({ ...motion, status: 'mayor_deferred', mayorReason: `approval limit is ${this.maxApprovals}` });
        continue;
      }
      seenDepartments.add(motion.department);
      approved.push({ ...motion, status: 'mayor_approved', mayorReason: reason || 'approved for planner validation' });
    }

    this.reviewCount++;
    this.lastReview = {
      label: this.label,
      approved: approved.map((motion) => motion.id),
      rejected: rejected.map((motion) => motion.id),
      deferred: deferred.map((motion) => motion.id)
    };
    return { approved, rejected, deferred, label: this.label };
  }

  stats() {
    return {
      label: this.label,
      maxApprovals: this.maxApprovals,
      reviewCount: this.reviewCount,
      lastReview: this.lastReview
    };
  }
}
