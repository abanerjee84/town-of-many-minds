import { HOUSEHOLD } from '../../core/config.js';

const FIRST = [
  'Ada', 'Bruno', 'Clara', 'Dmitri', 'Elif', 'Fen', 'Greta', 'Hugo', 'Ines', 'Jonas',
  'Kaya', 'Leo', 'Mira', 'Nils', 'Odette', 'Pablo', 'Quinn', 'Rosa', 'Sami', 'Tessa',
  'Ugo', 'Vera', 'Wes', 'Xime', 'Yara', 'Zeno', 'Anouk', 'Bela', 'Caius', 'Dahlia',
  'Eero', 'Frida', 'Gus', 'Halle', 'Ivo', 'Junia', 'Kai', 'Lina', 'Milo', 'Noor'
];

const LAST = [
  'Aalto', 'Bergström', 'Cardoso', 'Delacroix', 'Eriksen', 'Fontaine', 'Gallardo',
  'Halvorsen', 'Ibarra', 'Jönsson', 'Kowalski', 'Lindqvist', 'Moreau', 'Nakamura',
  'Okafor', 'Petrov', 'Quintero', 'Rasmussen', 'Sandoval', 'Thorne', 'Ustinov',
  'Valdez', 'Wexler', 'Yamada', 'Zeller', 'Bianchi', 'Crowe', 'Duarte', 'Engel',
  'Farrell', 'Gruber', 'Haddad', 'Iversen', 'Jarvis', 'Keller', 'Lombardi'
];

export const JOBS = [
  { id: 'baker', label: 'Baker', work: 'shop' },
  { id: 'barista', label: 'Barista', work: 'shop' },
  { id: 'shopkeeper', label: 'Shopkeeper', work: 'shop' },
  { id: 'chef', label: 'Chef', work: 'shop' },
  { id: 'teacher', label: 'Teacher', work: 'civic' },
  { id: 'librarian', label: 'Librarian', work: 'civic' },
  { id: 'clerk', label: 'Town Clerk', work: 'civic' },
  { id: 'nurse', label: 'Nurse', work: 'civic' },
  { id: 'mechanic', label: 'Mechanic', work: 'shop' },
  { id: 'artist', label: 'Artist', work: 'home' },
  { id: 'writer', label: 'Writer', work: 'home' },
  { id: 'musician', label: 'Musician', work: 'home' },
  { id: 'gardener', label: 'Gardener', work: 'park' },
  { id: 'courier', label: 'Courier', work: 'road' },
  // Phase 20 (C3b) — the white-collar trades move to the office block. They
  // were shop work before, which is why no office could staff itself.
  { id: 'accountant', label: 'Accountant', work: 'office' },
  { id: 'designer', label: 'Designer', work: 'office' },
  { id: 'officeclerk', label: 'Office Clerk', work: 'office' },
  { id: 'carpenter', label: 'Carpenter', work: 'shop' },
  { id: 'student', label: 'Student', work: 'civic' },
  { id: 'retired', label: 'Retired', work: 'home' },
  { id: 'photographer', label: 'Photographer', work: 'road' },
  { id: 'councillor', label: 'Councillor', work: 'civic' },
  { id: 'florist', label: 'Florist', work: 'shop' },
  { id: 'farmer', label: 'Farmer', work: 'farm' },
  { id: 'powerworker', label: 'Power Station Worker', work: 'power' },
  { id: 'attendant', label: 'Fuel Station Attendant', work: 'fuel' },
  { id: 'millworker', label: 'Sawmill Worker', work: 'industry' },
  { id: 'metallurgist', label: 'Steelworker', work: 'industry' },
  { id: 'cementworker', label: 'Cement Worker', work: 'industry' },
  { id: 'assembler', label: 'Factory Assembler', work: 'industry' }
];

const LEVEL_RANK = { none: 0, primary: 1, secondary: 2, tertiary: 3 };

/** Minimum schooling for a job — anything unlisted needs no credential. */
export const JOB_REQUIRE = {
  teacher: 'tertiary',
  nurse: 'tertiary',
  accountant: 'tertiary',
  councillor: 'tertiary',
  powerworker: 'tertiary',
  librarian: 'secondary',
  clerk: 'secondary',
  designer: 'secondary',
  mechanic: 'secondary',
  metallurgist: 'secondary',
  officeclerk: 'secondary'
};

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

const HOBBIES = [
  'bird watching', 'pottery', 'chess', 'cycling', 'astronomy', 'baking sourdough',
  'urban gardening', 'jazz records', 'kite flying', 'stamp collecting', 'rock climbing',
  'film photography', 'knitting', 'beekeeping', 'night fishing', 'geocaching',
  'collecting toy robots', 'competitive sudoku', 'salsa dancing', 'drone racing'
];

const CATCHPHRASES = [
  'Lovely weather for a walk.',
  'I never lock my front door.',
  'The bakery opens at six, you know.',
  'Mind the tram tracks.',
  'I have a spreadsheet for that.',
  'Everything is temporary except the potholes.',
  'Say hi to the fountain for me.',
  'My tomatoes are doing better than me.',
  'I peaked in the ninth grade.',
  'You can never have too many umbrellas.',
  'I only drive the speed limit. Usually.',
  'The bus is never on time, but it is honest.',
  'I know a shortcut. Trust me.',
  'Fresh bread fixes everything.',
  'I am saving that parking spot for later.',
  'Do not talk to me before my coffee.'
];

const QUIRKS = [
  'waves at every passing car',
  'always carries a spare umbrella',
  'counts the steps on the town hall stairs',
  'refuses to walk under ladders',
  'greets the fountain every morning',
  'keeps a pocket full of buttons',
  'hums while waiting at crossings',
  'names every potted plant',
  'insists the long way round is shorter',
  'collects lost single gloves',
  'salutes the war memorial',
  'takes photos of doorbells'
];

const TRAIT_KEYS = [
  'openness',
  'conscientiousness',
  'extraversion',
  'agreeableness',
  'neuroticism'
];

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
