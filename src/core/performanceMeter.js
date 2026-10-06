/** Foreground throughput, separate from the requested speed and physics budget. */
export class PerformanceMeter {
  constructor() { this.reset(); this.value = null; }
  reset() { this.wall = this.frames = this.calendar = this.agents = this.requested = 0; }
  sample({ wallSeconds, calendarSeconds, agentSeconds, requestedSeconds, visible = true }) {
    // A hidden-tab return is not an active-frame performance sample.
    if (!visible || !Number.isFinite(wallSeconds) || wallSeconds <= 0 || wallSeconds > 2) {
      this.reset(); return null;
    }
    this.wall += wallSeconds;
    this.frames++;
    this.calendar += Math.max(0, calendarSeconds);
    this.agents += Math.max(0, agentSeconds);
    this.requested += Math.max(0, requestedSeconds);
    if (this.wall < 0.5) return null;
    this.value = {
      fps: this.frames / this.wall,
      calendarRate: this.calendar / this.wall,
      agentRate: this.agents / this.wall,
      agentLag: this.requested > 0 ? Math.max(0, 1 - this.agents / this.requested) : 0
    };
    this.reset();
    return this.value;
  }
}
