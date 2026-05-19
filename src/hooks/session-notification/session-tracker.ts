export class SessionTracker {
  private mainSessionId: string | undefined
  private readonly subagents = new Set<string>()

  registerSession(id: string): void {
    if (this.mainSessionId === undefined) {
      this.mainSessionId = id
      return
    }
    if (id === this.mainSessionId) return
    this.subagents.add(id)
  }

  markAsSubagent(id: string): void {
    if (this.mainSessionId === id) {
      this.mainSessionId = undefined
    }
    this.subagents.add(id)
  }

  deleteSession(id: string): void {
    if (this.mainSessionId === id) {
      this.mainSessionId = undefined
    }
    this.subagents.delete(id)
  }

  isMain(id: string): boolean {
    return this.mainSessionId === id
  }

  isSubagent(id: string): boolean {
    return this.subagents.has(id)
  }
}
