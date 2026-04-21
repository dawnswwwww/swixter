import type { CircuitState, CircuitStateType } from "./types.js";

const FAILURE_THRESHOLD = 3;
const RECOVERY_TIMEOUT_MS = 60000;

export class CircuitBreaker {
  private states: Map<string, CircuitState> = new Map();
  private recoveryTimers: Map<string, Timer> = new Map();

  private getOrCreateState(profileId: string): CircuitState {
    if (!this.states.has(profileId)) {
      this.states.set(profileId, {
        profileId,
        consecutiveFailures: 0,
        isOpen: false,
        state: "closed",
      });
    }
    return this.states.get(profileId)!;
  }

  getState(profileId: string): CircuitState {
    return this.getOrCreateState(profileId);
  }

  isAvailable(profileId: string): boolean {
    const state = this.getState(profileId);
    return !state.isOpen;
  }

  recordSuccess(profileId: string): void {
    const state = this.getOrCreateState(profileId);
    state.consecutiveFailures = 0;
    state.isOpen = false;
    state.state = "closed";
    state.lastFailure = undefined;
    state.lastSuccess = new Date().toISOString();
    // Clear any recovery timer
    this.clearRecoveryTimer(profileId);
  }

  recordFailure(profileId: string): void {
    const state = this.getOrCreateState(profileId);
    state.consecutiveFailures++;
    state.lastFailure = new Date().toISOString();

    if (state.state === "half_open") {
      // Failure in half_open → go back to open
      state.isOpen = true;
      state.state = "open";
      this.scheduleRecovery(profileId);
      return;
    }

    if (state.consecutiveFailures >= FAILURE_THRESHOLD) {
      state.isOpen = true;
      state.state = "open";
      this.scheduleRecovery(profileId);
    }
  }

  private scheduleRecovery(profileId: string): void {
    this.clearRecoveryTimer(profileId);
    const timer = setTimeout(() => {
      this.checkRecovery(profileId);
    }, RECOVERY_TIMEOUT_MS);
    this.recoveryTimers.set(profileId, timer);
  }

  private clearRecoveryTimer(profileId: string): void {
    const existing = this.recoveryTimers.get(profileId);
    if (existing) {
      clearTimeout(existing);
      this.recoveryTimers.delete(profileId);
    }
  }

  checkRecovery(profileId: string): void {
    const state = this.states.get(profileId);
    if (!state || state.state !== "open") return;

    state.state = "half_open";
    state.isOpen = false;
  }

  // Test helper - force state to half_open
  forceHalfOpen(profileId: string): void {
    const state = this.getOrCreateState(profileId);
    state.state = "half_open";
    state.isOpen = false;
  }

  reset(): void {
    for (const timer of this.recoveryTimers.values()) {
      clearTimeout(timer);
    }
    this.recoveryTimers.clear();
    this.states.clear();
  }

  resetProvider(profileId: string): void {
    this.clearRecoveryTimer(profileId);
    this.states.delete(profileId);
  }
}
