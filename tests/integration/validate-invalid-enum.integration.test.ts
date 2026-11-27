import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { Command } from 'commander';
import { registerValidateCommand } from '../../src/commands/validate.js';
import { registerLogCommand } from '../../src/commands/log.js';
import { GitClient } from '../../src/services/git-client.js';
import { TrailerParser } from '../../src/services/trailer-parser.js';
import { AtomRepository } from '../../src/services/atom-repository.js';
import { Validator } from '../../src/services/validator.js';
import { SupersessionResolver } from '../../src/services/supersession-resolver.js';
import { JsonFormatter } from '../../src/formatters/json-formatter.js';
import { DEFAULT_CONFIG } from '../../src/types/config.js';

/**
 * Real-git integration for validator Rule 4 (invalid-enum). `parse()` drops
 * enum values it does not recognise, so Rule 4 must read the raw trailer
 * block; before the fix it could never fire on real commits. Query output
 * must keep treating such values as null: the parsed atom holds null and the
 * JSON formatter omits null enum fields.
 *
 * The commands are instantiated with real services, never spawned.
 * Windows-safe: os.tmpdir for the scratch repository, separator-agnostic
 * joins, and a hermetic git environment (empty global config, fixed identity).
 */

interface JsonValidationIssue {
  readonly severity: string;
  readonly rule: string;
  readonly message: string;
}

interface JsonValidationOutput {
  readonly valid: boolean;
  readonly results: readonly { readonly issues: readonly JsonValidationIssue[] }[];
}

interface JsonQueryOutput {
  readonly results: readonly {
    readonly lore_id: string;
    readonly trailers: Readonly<Record<string, unknown>>;
  }[];
}

const CONFIDENCE_EXPECTED = 'Expected one of: low, medium, high';
const SCOPE_RISK_EXPECTED = 'Expected one of: narrow, moderate, wide';

describe('lore validate invalid-enum (real git integration)', () => {
  let root: string;
  let env: Record<string, string>;
  let savedEnv: Record<string, string | undefined>;
  let fileCounter = 0;

  const git = (args: readonly string[]): string =>
    execFileSync('git', [...args], { cwd: root, env, encoding: 'utf-8' });

  /** Commit a fresh file with a verbatim message and return the commit hash. */
  const commitWithMessage = (message: string): string => {
    fileCounter += 1;
    writeFileSync(join(root, `file-${fileCounter}.txt`), `content ${fileCounter}\n`);
    git(['add', '-A']);
    git(['commit', '-q', '--cleanup=verbatim', '-m', message]);
    return git(['rev-parse', 'HEAD']).trim();
  };

  /** Run a command in-repo with real services and return its parsed JSON stdout. */
  const runLore = async <T>(args: readonly string[]): Promise<T> => {
    const gitClient = new GitClient(root);
    const trailerParser = new TrailerParser();
    const atomRepository = new AtomRepository(gitClient, trailerParser);
    const getFormatter = () => new JsonFormatter();
    const program = new Command();
    registerValidateCommand(program, {
      validator: new Validator(trailerParser, atomRepository, DEFAULT_CONFIG),
      gitClient,
      trailerParser,
      getFormatter,
    });
    registerLogCommand(program, {
      atomRepository,
      supersessionResolver: new SupersessionResolver(),
      getFormatter,
    });

    const output: string[] = [];
    const originalLog = console.log;
    console.log = (line: string) => {
      output.push(line);
    };
    try {
      await program.parseAsync(['node', 'lore', ...args]);
    } finally {
      console.log = originalLog;
    }
    return JSON.parse(output.join('\n')) as T;
  };

  /** Assert query output treats the given enum fields of an atom as null. */
  const expectNullEnumsInQuery = async (
    loreId: string,
    jsonKeys: readonly string[],
  ): Promise<void> => {
    const query = await runLore<JsonQueryOutput>(['log']);
    const atom = query.results.find((result) => result.lore_id === loreId);
    expect(atom).toBeDefined();
    for (const jsonKey of jsonKeys) {
      expect(atom!.trailers).not.toHaveProperty(jsonKey);
    }

    const parsed = await new AtomRepository(new GitClient(root), new TrailerParser()).findByLoreId(loreId);
    expect(parsed).not.toBeNull();
    expect(parsed!.trailers.Confidence).toBeNull();
  };

  /** Validate exactly one commit and return its invalid-enum messages. */
  const invalidEnumMessages = async (hash: string): Promise<readonly string[]> => {
    const output = await runLore<JsonValidationOutput>(['validate', `${hash}~1..${hash}`]);
    expect(output.results).toHaveLength(1);
    return output.results[0].issues
      .filter((issue) => issue.rule === 'invalid-enum')
      .map((issue) => {
        expect(issue.severity).toBe('error');
        return issue.message;
      });
  };

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'lore-validate-invalid-enum-'));
    const emptyConfig = join(root, 'empty-gitconfig');
    writeFileSync(emptyConfig, '');
    const hermetic = {
      GIT_CONFIG_GLOBAL: emptyConfig,
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_AUTHOR_NAME: 'Lore Test',
      GIT_AUTHOR_EMAIL: 'lore@example.com',
      GIT_COMMITTER_NAME: 'Lore Test',
      GIT_COMMITTER_EMAIL: 'lore@example.com',
    };
    env = { ...process.env, ...hermetic } as Record<string, string>;
    // GitClient.exec inherits process.env (only cwd is pinned), so the same
    // hermetic identity must hold for lore-driven git calls too.
    savedEnv = Object.fromEntries(
      Object.keys(hermetic).map((key) => [key, process.env[key]]),
    );
    Object.assign(process.env, hermetic);
    git(['init', '-q', '-b', 'main']);
    // Base commit so every case below has a parent for `<hash>~1..<hash>`.
    commitWithMessage('chore: base\n\nLore-id: 0000aaaa\n');
  });

  afterAll(() => {
    for (const [key, value] of Object.entries(savedEnv)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
    rmSync(root, { recursive: true, force: true });
  });

  it('reports an unknown Confidence value and keeps query output at null', async () => {
    const hash = commitWithMessage('fix: unknown confidence\n\nLore-id: 1111aaaa\nConfidence: very-high\n');

    expect(await invalidEnumMessages(hash)).toEqual([
      `Invalid Confidence value: "very-high". ${CONFIDENCE_EXPECTED}`,
    ]);

    await expectNullEnumsInQuery('1111aaaa', ['confidence']);
  });

  it('reports a wrongly cased Confidence value', async () => {
    const hash = commitWithMessage('fix: cased confidence\n\nLore-id: 2222aaaa\nConfidence: High\n');

    expect(await invalidEnumMessages(hash)).toEqual([
      `Invalid Confidence value: "High". ${CONFIDENCE_EXPECTED}`,
    ]);
  });

  it('reports an empty Confidence value as ""', async () => {
    const hash = commitWithMessage('fix: empty confidence\n\nLore-id: 3333aaaa\nConfidence:\n');

    expect(await invalidEnumMessages(hash)).toEqual([
      `Invalid Confidence value: "". ${CONFIDENCE_EXPECTED}`,
    ]);
  });

  it('reports one issue per invalid line, in order', async () => {
    const hash = commitWithMessage(
      'fix: two invalid enums\n\nLore-id: 4444aaaa\nConfidence: certain\nScope-risk: huge\n',
    );

    expect(await invalidEnumMessages(hash)).toEqual([
      `Invalid Confidence value: "certain". ${CONFIDENCE_EXPECTED}`,
      `Invalid Scope-risk value: "huge". ${SCOPE_RISK_EXPECTED}`,
    ]);

    await expectNullEnumsInQuery('4444aaaa', ['confidence', 'scope_risk']);
  });

  it('reports nothing for valid enum values', async () => {
    const hash = commitWithMessage(
      'fix: valid enums\n\nLore-id: 5555aaaa\nConfidence: high\nScope-risk: narrow\n',
    );

    expect(await invalidEnumMessages(hash)).toEqual([]);
  });
});
