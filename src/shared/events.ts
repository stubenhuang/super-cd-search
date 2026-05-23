/** Query event types for IPC communication */
export const QueryEvents = {
  START: 'query:start',
  PROGRESS: 'query:progress',
  RESULT: 'query:result',
  COMPLETE: 'query:complete',
  CANCELLED: 'query:cancelled',
  BATCH_CANCELLED: 'query:batch-cancelled',
  ERROR: 'query:error'
} as const

export type QueryEventType = typeof QueryEvents[keyof typeof QueryEvents]