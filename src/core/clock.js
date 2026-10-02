import { SIM, DEFAULT_SPEED } from './config.js';

const PERIODS = [
  { at: 5, name: 'Dawn' },
  { at: 7, name: 'Morning' },
  { at: 11, name: 'Midday' },
  { at: 13, name: 'Afternoon' },
  { at: 17, name: 'Evening' },
  { at: 20, name: 'Dusk' },
  { at: 22, name: 'Night' }
];

export class Clock {
  constructor(startHour = SIM.startHour) {
    this.hour = startHour;
    this.day = 1;
    this.speed = DEFAULT_SPEED;
    this.elapsed = 0;
  }

  reset(startHour = SIM.startHour) {
    this.hour = startHour;
    this.day = 1;
    this.speed = DEFAULT_SPEED;
    this.elapsed = 0;
  }

  update(dt) {
    const scaled = dt * this.speed * (1 / SIM.secondsPerGameMinute);
    this.hour += scaled / 60;
    this.elapsed += dt * this.speed;
    while (this.hour >= 24) {
      this.hour -= 24;
      this.day += 1;
    }
  }

  get minutes() {
    return Math.floor(this.hour * 60);
  }

  get timeString() {
    const h = Math.floor(this.hour);
    const m = Math.floor((this.hour - h) * 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  get period() {
    let name = 'Night';
    for (const p of PERIODS) {
      if (this.hour >= p.at) name = p.name;
    }
    return name;
  }

  get isNight() {
    return this.hour < 6 || this.hour > 19.5;
  }

  get daylight() {
    const t = this.hour;
    const rise = smooth(t, 5.5, 7.5);
    const set = 1 - smooth(t, 18.5, 20.5);
    return Math.min(rise, set);
  }

  get label() {
    return `Day ${this.day} · ${this.period}`;
  }
}

function smooth(x, a, b) {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
