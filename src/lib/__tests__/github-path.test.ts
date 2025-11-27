import { describe, it, expect } from 'vitest';

/**
 * Parse github_folder to get the correct path for fetching terminator.ts
 *
 * github_folder formats:
 * - UUID: "440ebe87-4da6-4821-b77d-941afbdf6299" (new format)
 * - Legacy snake_case: "onedrive_install_typescript", "ExampleClient_1_typescript"
 *
 * Both map to: {github_folder}/src/terminator.ts
 * No org prefix needed - folder is the direct path in mediar-ai/workflows repo
 */
export function getTerminatorPath(githubFolder: string): string {
  return `${githubFolder}/src/terminator.ts`;
}

describe('GitHub path parsing', () => {
  describe('UUID format (new)', () => {
    it('should handle UUID github_folder', () => {
      const result = getTerminatorPath('440ebe87-4da6-4821-b77d-941afbdf6299');
      expect(result).toBe(
        '440ebe87-4da6-4821-b77d-941afbdf6299/src/terminator.ts'
      );
    });

    it('should handle another UUID folder', () => {
      const result = getTerminatorPath('3aad4029-c6b2-408b-82cb-bd4161db20c3');
      expect(result).toBe(
        '3aad4029-c6b2-408b-82cb-bd4161db20c3/src/terminator.ts'
      );
    });
  });

  describe('Legacy snake_case format', () => {
    it('should handle legacy snake_case folder', () => {
      const result = getTerminatorPath('onedrive_install_typescript');
      expect(result).toBe('onedrive_install_typescript/src/terminator.ts');
    });

    it('should handle legacy numbered folder', () => {
      const result = getTerminatorPath('ExampleClient_1_typescript');
      expect(result).toBe('ExampleClient_1_typescript/src/terminator.ts');
    });
  });

  describe('Edge cases', () => {
    it('should handle folder with dashes', () => {
      const result = getTerminatorPath('my-workflow-name');
      expect(result).toBe('my-workflow-name/src/terminator.ts');
    });

    it('should handle simple folder name', () => {
      const result = getTerminatorPath('test');
      expect(result).toBe('test/src/terminator.ts');
    });
  });
});
