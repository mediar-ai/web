import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  validateModel,
  isAnthropicModel,
  isVertexModel,
  ALLOWED_MODELS,
  VERTEX_MODELS,
  ANTHROPIC_MODELS,
} from './providers.js';

describe('AI Providers', () => {
  describe('Model Validation', () => {
    describe('validateModel', () => {
      it('should validate all allowed Vertex models', () => {
        for (const model of VERTEX_MODELS) {
          expect(validateModel(model)).toBe(true);
        }
      });

      it('should validate all allowed Anthropic models', () => {
        for (const model of ANTHROPIC_MODELS) {
          expect(validateModel(model)).toBe(true);
        }
      });

      it('should reject invalid model names', () => {
        expect(validateModel('gpt-4')).toBe(false);
        expect(validateModel('claude-3')).toBe(false);
        expect(validateModel('')).toBe(false);
        expect(validateModel('gemini-1.0')).toBe(false);
      });

      it('should reject undefined and null', () => {
        expect(validateModel(undefined as any)).toBe(false);
        expect(validateModel(null as any)).toBe(false);
      });
    });

    describe('isAnthropicModel', () => {
      it('should return true for Anthropic models', () => {
        expect(isAnthropicModel('claude-sonnet-4-5-20250929')).toBe(true);
      });

      it('should return false for Vertex models', () => {
        expect(isAnthropicModel('gemini-2.5-flash')).toBe(false);
        expect(isAnthropicModel('gemini-2.5-pro')).toBe(false);
      });

      it('should return false for invalid models', () => {
        expect(isAnthropicModel('gpt-4')).toBe(false);
        expect(isAnthropicModel('')).toBe(false);
      });
    });

    describe('isVertexModel', () => {
      it('should return true for Vertex models', () => {
        expect(isVertexModel('gemini-2.5-flash')).toBe(true);
        expect(isVertexModel('gemini-2.5-pro')).toBe(true);
        expect(isVertexModel('gemini-3-pro-preview')).toBe(true);
      });

      it('should return false for Anthropic models', () => {
        expect(isVertexModel('claude-sonnet-4-5-20250929')).toBe(false);
      });

      it('should return false for invalid models', () => {
        expect(isVertexModel('gpt-4')).toBe(false);
        expect(isVertexModel('')).toBe(false);
      });
    });
  });

  describe('Model Constants', () => {
    it('should have correct number of models', () => {
      expect(VERTEX_MODELS.length).toBe(3);
      expect(ANTHROPIC_MODELS.length).toBe(1);
      expect(ALLOWED_MODELS.length).toBe(4);
    });

    it('should have no duplicates in ALLOWED_MODELS', () => {
      const unique = new Set(ALLOWED_MODELS);
      expect(unique.size).toBe(ALLOWED_MODELS.length);
    });

    it('ALLOWED_MODELS should be union of VERTEX and ANTHROPIC', () => {
      const combined = [...VERTEX_MODELS, ...ANTHROPIC_MODELS];
      expect(ALLOWED_MODELS).toEqual(combined);
    });
  });
});
