import { describe, expect, it } from 'vitest'
import { locate, segmentStarts } from './meetingAudio'

describe('segmentStarts', () => {
  it('uses the starts the transcript recorded', () => {
    expect(segmentStarts([0, 598.4], 2)).toEqual([0, 598.4])
  })

  it('assumes full ten-minute segments for older meetings', () => {
    expect(segmentStarts(undefined, 3)).toEqual([0, 600, 1200])
    // A stored list that does not match the files on disk is not trusted.
    expect(segmentStarts([0], 2)).toEqual([0, 600])
  })
})

describe('locate', () => {
  const starts = [0, 600, 1200]

  it('finds the segment and the time inside it', () => {
    expect(locate(starts, 0)).toEqual({ index: 0, offset: 0 })
    expect(locate(starts, 599)).toEqual({ index: 0, offset: 599 })
    expect(locate(starts, 600)).toEqual({ index: 1, offset: 0 })
    expect(locate(starts, 1300)).toEqual({ index: 2, offset: 100 })
  })

  it('stays in the first segment for a time before the start', () => {
    expect(locate(starts, -5)).toEqual({ index: 0, offset: 0 })
  })
})
