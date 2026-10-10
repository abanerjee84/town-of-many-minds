import { createPersonality, traitLabel, jobById, qualifies } from './personality.js';

export const LIFECYCLE_STAGES = [
  { id: 'infant', min: 0, max: 2 },
  { id: 'child', min: 3, max: 12 },
  { id: 'teen', min: 13, max: 17 },
  { id: 'adult', min: 18, max: 64 },
  { id: 'senior', min: 65, max: Infinity }
];

export const STAGE_LABEL = {
  infant: 'Infant',
  child: 'Childhood',
  teen: 'Teen',
  adult: 'Adult',
  senior: 'Senior'
};

export const EDUCATION_LABEL = {
  none: 'None',
  primary: 'Primary school',
  secondary: 'Secondary school',
  tertiary: 'College'
};

const WAGES = {
  baker: 31000, barista: 24000, shopkeeper: 38000, chef: 33000, teacher: 44000,
  librarian: 34000, clerk: 32000, nurse: 46000, mechanic: 39000, artist: 26000,
  writer: 30000, musician: 28000, gardener: 29000, courier: 27000, designer: 41000,
  accountant: 47000, carpenter: 37000, student: 6000, retired: 18000, officeclerk: 30000,
  photographer: 32000, councillor: 52000, florist: 26000,
  farmer: 29000, powerworker: 43000, attendant: 27000,
  millworker: 30000, metallurgist: 41000, cementworker: 34000, assembler: 31000
};

export const jobAnnualWage = (jobId) => WAGES[jobId] || 30000;

const JOB_SKILLS = {
  baker: ['baking', 'hygiene'], barista: ['hospitality', 'speed'],
  shopkeeper: ['sales', 'bookkeeping'], chef: ['cooking', 'hygiene'],
  teacher: ['teaching', 'communication'], librarian: ['research', 'organisation'],
  clerk: ['administration', 'communication'], nurse: ['care', 'first aid'],
  mechanic: ['repair', 'engineering'], artist: ['drawing', 'patience'],
  writer: ['writing', 'research'], musician: ['music', 'performance'],
  gardener: ['horticulture', 'patience'], courier: ['driving', 'navigation'],
  design: ['design', 'communication'], designer: ['design', 'communication'],
  accountant: ['bookkeeping', 'analysis'], carpenter: ['woodwork', 'measuring'],
  officeclerk: ['administration', 'bookkeeping'],
  student: ['study', 'communication'], retired: ['storytelling', 'patience'],
  photographer: ['photography', 'composition'], councillor: ['negotiation', 'speech'],
  florist: ['horticulture', 'sales'], farmer: ['farming', 'patience'],
  powerworker: ['electrical', 'safety'],
  attendant: ['sales', 'repair'],
  millworker: ['woodwork', 'machinery'], metallurgist: ['metallurgy', 'safety'],
  cementworker: ['materials', 'machinery'], assembler: ['assembly', 'precision']
};

const FIELDS = {
  baker: 'Culinary arts', chef: 'Culinary arts', teacher: 'Education',
  librarian: 'Library science', clerk: 'Public administration', nurse: 'Nursing',
  mechanic: 'Automotive engineering', accountant: 'Finance', designer: 'Design',
  student: 'Undeclared', councillor: 'Public policy', courier: 'Logistics',
  carpenter: 'Construction', gardener: 'Horticulture', artist: 'Fine art',
  officeclerk: 'Business administration',
  writer: 'Literature', musician: 'Music', photographer: 'Media',
  farmer: 'Agriculture', powerworker: 'Power engineering', attendant: 'Automotive engineering',
  millworker: 'Wood processing', metallurgist: 'Metallurgy',
  cementworker: 'Materials', assembler: 'Manufacturing'
};

const TRANSPORT = [
  { id: 'walk', weight: 5 },
  { id: 'bike', weight: 3 },
  { id: 'bus', weight: 3 },
  { id: 'car', weight: 4 }
];

export function stageOf(age) {
  for (const s of LIFECYCLE_STAGES) if (age >= s.min && age <= s.max) return s.id;
  return 'senior';
}

export function stageLabel(age) {
  return STAGE_LABEL[stageOf(age)] || 'Adult';
}

export function pushHistory(p, text) {
  if (!p.history) p.history = [];
  p.history.push({ age: Math.round(p.age * 10) / 10, text });
  if (p.history.length > 14) p.history.shift();
}

/**
 * Daily need drain. `res` is the resource-stress object from
 * `resourceStress()` — food shortages make hunger bite faster, blackouts
 * drain energy faster, so wellbeing tracks the resource lines directly.
 */
export function needsTick(p, hours, res = null) {
  const n = p.needs;
  if (!n) return;
  const t = p.traits;
  const food = res ? res.food || 0 : 0;
  const energy = res ? res.energy || 0 : 0;
  n.fullness = Math.max(0, n.fullness - 0.055 * hours * (0.85 + t.extraversion * 0.3) * (1 + food * 1.2));
  n.energy = Math.max(0, n.energy - 0.042 * hours * (1 + energy * 1.2));
  n.social = Math.max(0, n.social - 0.03 * hours * (1.2 - p.sociability * 0.7));
  n.leisure = Math.max(0, n.leisure - 0.036 * hours);
}

function seedNeeds(rng) {
  return {
    fullness: rng.float(0.6, 1),
    energy: rng.float(0.6, 1),
    social: rng.float(0.4, 1),
    leisure: rng.float(0.4, 1)
  };
}

export function scheduleFor(jobId, stage) {
  if (stage === 'infant') {
    // Toddlers do not attend school: a home day with two park outings, so a
    // newborn is actually visible on the streets instead of vanishing into
    // the school building from 08:00 to 16:00. Windows mirror desiredKey().
    return [
      { from: 6.5, to: 10, label: 'At home' },
      { from: 10, to: 12, label: 'At the park' },
      { from: 12, to: 15.5, label: 'Nap' },
      { from: 15.5, to: 18, label: 'At the park' },
      { from: 18, to: 22, label: 'Bedtime routine' },
      { from: 22, to: 6.5, label: 'Sleep' }
    ];
  }
  if (stage === 'child' || stage === 'teen') {
    return [
      { from: 6.5, to: 7.5, label: 'Getting ready' },
      { from: 8, to: 15, label: 'School' },
      { from: 15, to: 18, label: 'Play & homework' },
      { from: 18, to: 22, label: 'Home' },
      { from: 22, to: 6.5, label: 'Sleep' }
    ];
  }
  if (jobId === 'retired') {
    return [
      { from: 6.5, to: 9, label: 'Slow morning' },
      { from: 9, to: 12, label: 'Errands' },
      { from: 12, to: 17, label: 'Hobbies' },
      { from: 17, to: 22, label: 'Home' },
      { from: 22, to: 6.5, label: 'Sleep' }
    ];
  }
  if (jobId === 'student') {
    return [
      { from: 7, to: 8, label: 'Commute' },
      { from: 8, to: 16, label: 'Classes' },
      { from: 16, to: 20, label: 'Study & leisure' },
      { from: 20, to: 22, label: 'Home' },
      { from: 22, to: 7, label: 'Sleep' }
    ];
  }
  return [
    { from: 6.5, to: 7.5, label: 'Morning routine' },
    { from: 8, to: 12, label: 'Work' },
    { from: 12, to: 13, label: 'Lunch' },
    { from: 13, to: 17, label: 'Work' },
    { from: 17, to: 19.5, label: 'Leisure' },
    { from: 19.5, to: 22, label: 'Home' },
    { from: 22, to: 6.5, label: 'Sleep' }
  ];
}

export function scheduleAt(schedule, hour) {
  for (const s of schedule) {
    if (s.from <= s.to ? hour >= s.from && hour < s.to : hour >= s.from || hour < s.to) return s.label;
  }
  return 'Resting';
}

export function createProfile(rng, opts = {}) {
  const p = createPersonality(rng, opts);
  const parents = opts.parents || null;

  const genetics = {
    height: parents
      ? (parents[0].genetics.height + parents[1].genetics.height) / 2 + rng.gauss(0, 0.035)
      : rng.float(1.56, 1.93),
    longevity: parents
      ? (parents[0].genetics.longevity + parents[1].genetics.longevity) / 2 + rng.gauss(0, 3.5)
      : rng.float(72, 92),
    metabolism: rng.float(0.7, 1.3),
    traits: { ...p.traits }
  };
  genetics.height = Math.max(1.4, Math.min(2.05, genetics.height));
  genetics.longevity = Math.max(58, Math.min(98, genetics.longevity));

  const stage = stageOf(p.age);
  // Schooling was rolled inside createPersonality (before the job roll, so the
  // job pool matched the education path); read it back from opts instead of
  // rolling a second, inconsistent ladder here.
  const educationLevel = opts.education || 'none';

  const skills = [];
  const wanted = JOB_SKILLS[p.job.id] || ['communication', 'teamwork'];
  for (const id of wanted) skills.push({ id, level: rng.float(0.3, 0.9) });
  if (rng.chance(0.6)) skills.push({ id: 'teamwork', level: rng.float(0.3, 0.85) });
  if (educationLevel === 'tertiary') skills.push({ id: 'analysis', level: rng.float(0.5, 0.95) });

  const income =
    p.job.id === 'retired'
      ? Math.round(WAGES.retired * rng.float(0.7, 1.2))
      : p.job.id === 'student'
        ? 0
        : Math.round((WAGES[p.job.id] || 30000) * rng.float(0.85, 1.15));

  p.genetics = genetics;
  p.physicalTraits = {
    height: genetics.height,
    build: p.avatar.build,
    vision: rng.float(0.7, 1),
    fitness: rng.float(0.35, 0.95),
    strength: rng.float(0.3, 0.9)
  };
  p.intelligence = rng.float(0.3, 0.95);
  p.skills = skills;
  p.education = {
    level: educationLevel,
    field: FIELDS[p.job.id] || (educationLevel === 'tertiary' ? 'General studies' : '—'),
    years: educationLevel === 'tertiary' ? 16 : educationLevel === 'secondary' ? 12 : educationLevel === 'primary' ? 5 : 0
  };
  p.health = rng.float(0.72, 1);
  p.conditions = [];
  p.income = income;
  // A new arrival comes with cash in their pocket and NO savings. That is not a
  // cosmetic choice: the bank's deposit liability is created only by a real
  // transfer, so a profile that started life with a savings balance would owe
  // the bank money it never received. The first day boundary banks a share of
  // the opening cash (EconomySystem.openFirstAccount), which is how a household
  // ends up with savings by day one without the books ever being wrong.
  const opening = Math.round(income * rng.float(0.15, 3.2));
  p.wealth = opening;
  p.cash = opening;
  p.deposits = 0;
  p.grossIncome = 0;
  p.disposableIncome = 0;
  p.consumption = 0;
  p.housingCost = 0;
  p.taxPaid = 0;
  p.debt = 0;
  p.propertyValue = 0;
  // Savings held at the bank. Mirrors `deposits`; `netWorth` is computed from
  // `deposits` directly, and this field exists because other systems already
  // read `financialAssets` for a household's non-cash wealth.
  p.financialAssets = 0;
  p.netWorth = p.cash;
  p.employmentStatus = stage === 'adult' && p.job.id !== 'student' ? 'unemployed' : 'not_in_labor_force';
  p.needs = seedNeeds(rng);
  p.preferences = {
    transport: rng.weighted(TRANSPORT).id,
    spending: Math.min(1, Math.max(0, p.traits.conscientiousness * 0.5 + rng.float(0, 0.6))),
    community: Math.min(1, p.sociability * 0.7 + rng.float(0, 0.4)),
    housing: rng.weighted([
      { id: 'quiet', weight: 4 },
      { id: 'central', weight: 3 },
      { id: 'rural', weight: 2 }
    ]).id
  };
  p.relationships = { partner: null, parents: parents ? parents.map((x) => x.id) : [], children: [], friends: [] };
  p.schedule = scheduleFor(p.job.id, stage);
  p.stage = stage;
  p.activity = 'at home';
  p.location = { place: 'home', x: 0, y: 0 };
  p.history = [{ age: p.age, text: 'Arrived in town.' }];
  p.generation = parents ? 2 : 1;
  return p;
}

/**
 * Move an existing citizen into a different job. The stage stays as it is;
 * schedule, wage, field and skills are the things that hang off the job id
 * and have to be re-derived.
 */
export function setJob(p, jobId, rng) {
  const job = jobById(jobId);
  if (!job || p.job?.id === jobId) return false;
  // The education gate: nobody is moved into a job their schooling does not
  // cover (hires arrive credentialed via credentialFloor instead).
  if (!qualifies(p.education?.level, jobId)) return false;
  p.job = job;
  p.schedule = scheduleFor(jobId, p.stage || stageOf(p.age));
  if (jobId !== 'student' && jobId !== 'retired') {
    p.income = Math.round((WAGES[jobId] || 30000) * rng.float(0.85, 1.15));
  }
  if (FIELDS[jobId]) p.education.field = FIELDS[jobId];
  for (const id of JOB_SKILLS[jobId] || []) {
    if (!p.skills.some((s) => s.id === id)) p.skills.push({ id, level: rng.float(0.35, 0.9) });
  }
  pushHistory(p, `Started work as a ${job.label.toLowerCase()}.`);
  return true;
}

export function refreshStage(p) {
  const next = stageOf(p.age);
  if (next === p.stage) return false;
  p.stage = next;
  p.schedule = scheduleFor(p.job.id, next);
  return true;
}

export function needsAverage(p) {
  const n = p.needs;
  if (!n) return 1;
  return (n.fullness + n.energy + n.social + n.leisure) / 4;
}

export function describeProfile(p, clock) {
  const rel = [];
  if (p.relationships?.partner) rel.push(`Partner · ${p.relationships.partner}`);
  if (p.relationships?.children?.length) rel.push(`${p.relationships.children.length} child(ren)`);
  if (!rel.length) rel.push('Single');
  return {
    stage: stageLabel(p.age),
    education: `${EDUCATION_LABEL[p.education.level]} · ${p.education.field}`,
    income: p.income,
    wealth: p.wealth,
    health: p.health,
    intelligence: p.intelligence,
    skills: p.skills,
    schedule: scheduleAt(p.schedule, clock ? clock.hour : 12),
    relationships: rel,
    needs: p.needs,
    preferences: p.preferences,
    history: (p.history || []).slice(-3),
    traitLabel
  };
}
