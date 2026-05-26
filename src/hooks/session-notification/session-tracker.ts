export class SessionTracker {
  private mainSessionId: string | undefined

  registerSession(id: string): void {
    if (this.mainSessionId === undefined) {
      this.mainSessionId = id
    }
  }

  deleteSession(id: string): void {
    if (this.mainSessionId === id) {
      this.mainSessionId = undefined
    }
  }

  isMain(id: string): boolean {
    return this.mainSessionId === id
  }
}
