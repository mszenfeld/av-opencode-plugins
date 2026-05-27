export interface BackgroundTask {
  id: string
  childSessionId: string
  parentSessionId: string
  agent: string
  startedAt: number
}

/**
 * In-memory registry of running background tasks, keyed by task id and scoped
 * by parent session. Holds the parent->child mapping only — no results, no
 * proactive completion detection (status is derived at collect time by polling
 * the child session). Constructed once per coordinator plugin factory and shared
 * by the three background tools.
 */
export class BackgroundTaskStore {
  private readonly tasks = new Map<string, BackgroundTask>()

  register(task: BackgroundTask): void {
    this.tasks.set(task.id, task)
  }

  get(id: string): BackgroundTask | undefined {
    return this.tasks.get(id)
  }

  listByParent(parentSessionId: string): BackgroundTask[] {
    return [...this.tasks.values()].filter(
      (t) => t.parentSessionId === parentSessionId,
    )
  }

  countRunningByParent(parentSessionId: string): number {
    return this.listByParent(parentSessionId).length
  }

  remove(id: string): void {
    this.tasks.delete(id)
  }

  removeByChild(childSessionId: string): void {
    for (const [id, t] of this.tasks) {
      if (t.childSessionId === childSessionId) this.tasks.delete(id)
    }
  }

  clearParent(parentSessionId: string): void {
    for (const [id, t] of this.tasks) {
      if (t.parentSessionId === parentSessionId) this.tasks.delete(id)
    }
  }
}
