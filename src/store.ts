import type { Click, Install, Link, Signup } from "./domain/types.js";

export type Binding = { installId: string; boundAt: Date };

export class InMemoryStore {
  readonly links = new Map<string, Link>();
  readonly clicks = new Map<string, Click>();
  readonly installs = new Map<string, Install>();
  readonly bindings = new Map<string, Binding>();
  readonly signups = new Map<string, Signup>();
  private sequence = 0;

  nextSequence(): number {
    this.sequence += 1;
    return this.sequence;
  }

  clickIdsForInstall(installId: string): string[] {
    return [...this.bindings].filter(([, b]) => b.installId === installId).map(([clickId]) => clickId);
  }

  consumerOfInstall(installId: string): Signup | null {
    return [...this.signups.values()].find((s) => s.install.status === "consumed" && s.install.installId === installId) ?? null;
  }
}
