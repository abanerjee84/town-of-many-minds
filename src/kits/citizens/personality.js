import { HOUSEHOLD } from '../../core/config.js';
import content from '../../data/citizenContent.json' with { type: 'json' };

const FIRST = content.firstNames;
const LAST = content.lastNames;

export const JOBS = content.jobs;

const LEVEL_RANK = { none: 0, primary: 1, secondary: 2, tertiary: 3 };

/** Minimum schooling for a job — anything unlisted needs no credential. */
export const JOB_REQUIRE = content.jobRequirements;

export function qualifies(level, jobId) {
  const id = jobId && typeof jobId === 'object' ? jobId.id : jobId;
  if (!id || id === 'student' || id === 'retired') return true;
  const req = JOB_REQUIRE[id];
  if (!req) return true;
  return (LEVEL_RANK[level] ?? 0) >= LEVEL_RANK[req];
}

/** Jobs an adult with `level` schooling may actually be rolled into. */
export function qualifiedJobs(level) {
  return JOBS.filter(
    (j) => j.id !== 'student' && j.id !== 'retired' && qualifies(level, j)
  );
}

function jobWeight(j) {
  return j.id === 'retired'
    ? 6
    : j.work === 'shop'
      ? 14
      : j.work === 'farm' || j.work === 'power' || j.work === 'industry'
        ? 12
        : 10;
}

/** One weighted draw from the jobs `level` qualifies for (never student/retired). */
export function rollJob(rng, level) {
  const pool = qualifiedJobs(level);
  if (!pool.length) return null;
  return rng.weighted(pool.map((j) => ({ ...j, weight: jobWeight(j) })));
}

/** Age-derived schooling — the same ladder `lifecycle.progress` walks. */
export function rollEducation(rng, age) {
  if (age < 13) return 'none';
  if (age < 18) return 'primary';
  if (age >= 22 && rng.chance(0.45)) return 'tertiary';
  return 'secondary';
}

/** Lowest level that satisfies a job's requirement (or the given level). */
export function credentialFloor(level, jobId) {
  const id = jobId && typeof jobId === 'object' ? jobId.id : jobId;
  const req = id ? JOB_REQUIRE[id] : null;
  if (!req) return level || 'none';
  return (LEVEL_RANK[level] ?? 0) >= LEVEL_RANK[req] ? level : req;
}

const HOBBIES = content.hobbies;
const CATCHPHRASES = content.catchphrases;
const QUIRKS = content.quirks;
const TRAIT_KEYS = content.traits;

function trait(rng, mean = 0.5, sd = 0.18) {
  return Math.min(0.99, Math.max(0.01, rng.gauss(mean, sd)));
}

export function createPersonality(rng, opts = {}) {
  const first = rng.pick(FIRST);
  const last = opts.surname || rng.pick(LAST);
  const age = opts.age ?? rng.int(18, 78);
  // Schooling lands before the job roll so the pool is the candidate's own
  // education path; a pinned job (hired / immigrated for work) bumps the
  // credential up to its requirement instead of refusing the arrival.
  if (!opts.education) opts.education = rollEducation(rng, age);
  opts.education = credentialFloor(opts.education, opts.job);
  let job = opts.job;
  if (!job) {
    if (age < 19) job = JOBS.find((j) => j.id === 'student');
    else if (age >= 66) job = JOBS.find((j) => j.id === 'retired');
  }
  if (!job) job = rollJob(rng, opts.education);

  const traits = {};
  for (const k of TRAIT_KEYS) traits[k] = trait(rng);

  const sociability = Math.min(1, traits.extraversion * 0.75 + traits.agreeableness * 0.35);
  const patience = Math.min(
    1,
    traits.conscientiousness * 0.5 + (1 - traits.neuroticism) * 0.35 + traits.agreeableness * 0.2
  );
  const pace = 0.85 + traits.conscientiousness * 0.35 + rng.float(-0.08, 0.12);
  const chattiness = Math.min(1, sociability * 0.7 + traits.openness * 0.4);
  const optimism = Math.min(1, 1 - traits.neuroticism * 0.7 + traits.agreeableness * 0.3);

  return {
    id: opts.id || `${first}-${last}-${rng.int(100, 999)}`,
    name: `${first} ${last}`,
    first,
    last,
    surname: last,
    age,
    job,
    traits,
    sociability,
    patience,
    pace,
    chattiness,
    optimism,
    hobby: rng.pick(HOBBIES),
    catchphrase: rng.pick(CATCHPHRASES),
    quirk: rng.pick(QUIRKS),
    favoriteColor: rng.int(0, 11),
    avatar: {
      scale: rng.float(0.9, 1.1),
      build: rng.weighted([
        { id: 'slim', weight: 3 },
        { id: 'average', weight: 5 },
        { id: 'sturdy', weight: 3 }
      ]).id,
      skin: rng.int(0, 5),
      shirt: rng.int(0, 11),
      pants: rng.int(0, 7),
      hair: rng.int(0, 6),
      hairStyle: rng.weighted([
        { id: 'short', weight: 5 },
        { id: 'long', weight: 3 },
        { id: 'bun', weight: 2 },
        { id: 'cap', weight: 2 },
        { id: 'bald', weight: 1 }
      ]).id,
      accessory: rng.weighted([
        { id: 'none', weight: 5 },
        { id: 'glasses', weight: 3 },
        { id: 'backpack', weight: 2 },
        { id: 'bag', weight: 2 },
        { id: 'umbrella', weight: 1 }
      ]).id,
      facialHair: rng.chance(0.35)
    }
  };
}

export function pickSurname(rng) {
  return rng.pick(LAST);
}

export function jobById(id) {
  return JOBS.find((j) => j.id === id) || null;
}

export function pickHouseholdSize(rng) {
  return rng.weighted(HOUSEHOLD.sizes.map((s) => ({ ...s }))).size;
}

export function familyAge(rng, index, size) {
  if (size <= 1) return rng.int(24, 74);
  if (index === 0) return rng.int(30, 62);
  if (index === 1) return rng.int(28, 60);
  return rng.chance(0.72) ? rng.int(6, 24) : rng.int(66, 82);
}

export function traitLabel(value) {
  if (value > 0.75) return 'very high';
  if (value > 0.6) return 'high';
  if (value > 0.4) return 'moderate';
  if (value > 0.25) return 'low';
  return 'very low';
}

/**
 * Instant mood for a citizen in `state`. `stress` (0..1, from
 * `resourceStress`) drags the baseline down — shortages and deficits hit
 * the worried hardest, the optimistic shrug them off.
 */
export function moodFrom(p, state, stress = 0) {
  let m = 0.32 + p.optimism * 0.35 + p.patience * 0.15;
  if (state === 'chatting') m += 0.18 * p.sociability;
  if (state === 'commuting') m -= 0.2 * (1 - p.patience);
  if (state === 'idle') m += 0.05;
  if (state === 'seeking') m -= 0.12 * (1 - p.patience);
  if (stress > 0) m -= stress * (0.35 + (1 - p.optimism) * 0.2);
  return Math.max(0, Math.min(1, m));
}
