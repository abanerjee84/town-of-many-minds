import { makeRng } from '../core/rng.js';
import { events } from '../core/events.js';
import chart from '../data/weather.json' with { type: 'json' };

/** A deterministic, low-frequency weather model shared by all consumers. */
export const WEATHER_CHART = chart;
export const DAYS_PER_SEASON = chart.daysPerSeason;
export const DAYS_PER_YEAR = DAYS_PER_SEASON * 4;

const SEASONS = chart.seasons;
const STATES = chart.states;

const clampDay = (day) => Math.max(1, Math.floor(Number(day) || 1));

export class WeatherSystem {
  constructor(town) {
    this.town = town;
    this.reset(1);
  }

  reset(seed = 1) {
    this.seed = seed;
    this.lastDay = 0;
    this.nextChangeDay = 1;
    this.seasonIndex = -1;
    this.currentId = 'clear';
    this.transitions = 0;
    this.history = [];
    this.update({ day: 1 }, true, false);
  }

  seasonForDay(day) {
    const d = clampDay(day);
    const yearDay = (d - 1) % DAYS_PER_YEAR;
    const index = Math.floor(yearDay / DAYS_PER_SEASON);
    return {
      ...SEASONS[index],
      index,
      year: Math.floor((d - 1) / DAYS_PER_YEAR) + 1,
      dayOfSeason: (yearDay % DAYS_PER_SEASON) + 1,
      dayOfYear: yearDay + 1
    };
  }

  pickWeather(day, season) {
    const rng = makeRng(`${this.seed}:weather:${day}`);
    return rng.pick(season.weather);
  }

  update(clock, force = false, announce = true) {
    const day = clampDay(clock?.day);
    const season = this.seasonForDay(day);
    const seasonChanged = season.index !== this.seasonIndex;
    if (!force && day === this.lastDay && !seasonChanged) return this.current;
    if (force || seasonChanged || day >= this.nextChangeDay) {
      const previous = this.currentId;
      this.currentId = this.pickWeather(day, season);
      this.seasonIndex = season.index;
      const state = STATES[this.currentId] || STATES.clear;
      const rng = makeRng(`${this.seed}:weather-duration:${day}`);
      this.nextChangeDay = day + 1 + rng.int(0, 2);
      if (previous !== this.currentId || seasonChanged) {
        this.transitions++;
        const snapshot = this.stats();
        this.history.push({ day, season: season.id, weather: this.currentId });
        if (this.history.length > 12) this.history.shift();
        if (announce) {
          events.emit('weather-change', snapshot);
          events.emit('log', { kind: 'event', text: `Weather: ${snapshot.seasonLabel} ${snapshot.weatherLabel.toLowerCase()} (${snapshot.temperature}°C).` });
        }
      }
    }
    this.lastDay = day;
    return this.current;
  }

  currentModifiers() {
    const season = this.seasonForDay(this.lastDay || 1);
    const state = STATES[this.currentId] || STATES.clear;
    return {
      foodYield: state.foodYield,
      energyDemand: state.energyDemand,
      waterDemand: state.waterDemand,
      trafficFactor: state.trafficFactor,
      moodDelta: state.moodDelta,
      precipitation: state.precipitation,
      temperature: season.temperature + state.delta
    };
  }

  get current() {
    return { id: this.currentId, ...STATES[this.currentId] };
  }

  stats() {
    const season = this.seasonForDay(this.lastDay || 1);
    const state = STATES[this.currentId] || STATES.clear;
    const modifiers = this.currentModifiers();
    return {
      season: season.id,
      seasonLabel: season.label,
      seasonIcon: season.icon,
      seasonIndex: season.index,
      year: season.year,
      dayOfSeason: season.dayOfSeason,
      dayOfYear: season.dayOfYear,
      weather: this.currentId,
      weatherLabel: state.label,
      icon: state.icon,
      temperature: modifiers.temperature,
      precipitation: state.precipitation,
      modifiers,
      nextChangeDay: this.nextChangeDay,
      transitions: this.transitions,
      history: this.history.slice()
    };
  }
}
