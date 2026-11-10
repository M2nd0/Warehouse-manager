import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/** All .ts files under a directory. */
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return path.endsWith('.ts') ? [path] : [];
  });
}

const imports = (file: string): string[] =>
  [...readFileSync(file, 'utf8').matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]);

describe('architecture (CLAUDE.md)', () => {
  const simFiles = sources('src/sim');

  it('src/sim does not import Three.js, the UI, the renderer or Node', () => {
    expect(simFiles.length).toBeGreaterThan(15);
    for (const file of simFiles) {
      for (const specifier of imports(file)) {
        expect(specifier, file).not.toMatch(/^(three|preact|node:)/);
        expect(specifier, file).not.toMatch(/\/(render|ui)(\/|$)/);
      }
    }
  });

  it('src/sim does not touch the DOM, wall-clock time or unseeded randomness', () => {
    for (const file of simFiles) {
      const code = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
      expect(code, file).not.toMatch(/\b(window|document|requestAnimationFrame|performance)\s*\./);
      expect(code, file).not.toMatch(/Math\.random|Date\.now|new Date\(/);
      expect(code, file).not.toMatch(/Math\.(exp|log|pow|sin|cos|tan)\b/);
    }
  });

  it('every system exports step(state, ctx)', () => {
    const systems = import.meta.glob<{ step?: unknown }>('../src/sim/systems/*.ts', { eager: true });
    expect(Object.keys(systems)).toHaveLength(sources('src/sim/systems').length);
    expect(Object.keys(systems).length).toBeGreaterThanOrEqual(7);
    for (const [file, module] of Object.entries(systems)) {
      expect(typeof module.step, file).toBe('function');
      expect((module.step as (...args: unknown[]) => unknown).length, file).toBe(2);
    }
  });

  it('render and UI never write to the game state', () => {
    for (const file of [...sources('src/render'), ...sources('src/ui')]) {
      const code = readFileSync(file, 'utf8');
      expect(code, file).not.toMatch(/\bstate\.[\w.[\]]+\s*(=(?!=)|\+\+|--|\+=|-=)/);
      expect(code, file).not.toMatch(/\bstate\.[\w.]+\.(push|splice|set|delete|pop|shift)\(/);
    }
  });
});
