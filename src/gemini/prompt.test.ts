import { describe, expect, it } from 'vitest'
import { buildSystemPrompt } from './prompt'

describe('buildSystemPrompt', () => {
  it('builds distinct prompts for verbatim, clean, english, and bullets modes', () => {
    expect(buildSystemPrompt('my', 'verbatim')).toContain('verbatim')
    expect(buildSystemPrompt('my', 'clean')).toContain('Remove filler words')
    expect(buildSystemPrompt('my', 'english')).toContain('Output ONLY the English text')
    expect(buildSystemPrompt('my', 'bullets')).toContain('bullet list')
  })

  it('appends auto-detect instructions for non-english output modes', () => {
    expect(buildSystemPrompt('auto', 'verbatim')).toContain('Detect the spoken language')
    expect(buildSystemPrompt('auto', 'clean')).toContain('Detect the spoken language')
    expect(buildSystemPrompt('auto', 'english')).not.toContain('Detect the spoken language')
  })
})
