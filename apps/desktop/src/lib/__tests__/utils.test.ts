import { describe, it, expect } from 'vitest'
import { cn } from '../utils'

describe('utils', () => {
  describe('cn (className utility)', () => {
    it('should merge class names correctly', () => {
      const result = cn('base', 'additional')
      expect(typeof result).toBe('string')
      expect(result.length).toBeGreaterThan(0)
    })

    it('should handle undefined and null values', () => {
      const result = cn('base', undefined, null, 'valid')
      expect(typeof result).toBe('string')
      expect(result).toContain('base')
      expect(result).toContain('valid')
    })

    it('should handle empty strings', () => {
      const result = cn('', 'valid', '')
      expect(typeof result).toBe('string')
      expect(result).toContain('valid')
    })

    it('should work with single class', () => {
      const result = cn('single')
      expect(result).toBe('single')
    })

    it('should work with no arguments', () => {
      const result = cn()
      expect(typeof result).toBe('string')
    })

    it('should handle conditional classes', () => {
      const isActive = true
      const isDisabled = false

      const result = cn(
        'base',
        isActive && 'active',
        isDisabled && 'disabled'
      )

      expect(result).toContain('base')
      expect(result).toContain('active')
      expect(result).not.toContain('disabled')
    })
  })
})
