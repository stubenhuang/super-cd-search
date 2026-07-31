import { describe, it, expect } from 'vitest'
import { QueryEvents } from '../src/shared/events'

describe('QueryEvents', () => {
  it('exposes all query event channel names', () => {
    expect(QueryEvents).toEqual({
      START: 'query:start',
      PROGRESS: 'query:progress',
      RESULT: 'query:result',
      COMPLETE: 'query:complete',
      CANCELLED: 'query:cancelled',
      BATCH_CANCELLED: 'query:batch-cancelled',
      ERROR: 'query:error'
    })
  })
})
