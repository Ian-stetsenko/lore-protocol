import { Command } from 'commander';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { version } = require('../package.json') as { version: string };

import type { IGitClient } from './interfaces/git-client.js';
import type { IConfigLoader } from './interfaces/config-loader.js';
import type { IOutputFormatter } from './interfaces/output-formatter.js';

import { GitClient } from './services/git-client.js';
import { TrailerParser } from './services/trailer-parser.js';
import { PathResolver } from './services/path-resolver.js';
import { LoreIdGenerator } from './services/lore-id-generator.js';
import { ConfigLoader } from './services/config-loader.js';
import { AtomRepository } from './services/atom-repository.js';
import { SupersessionResolver } from './services/supersession-resolver.js';
import { StalenessDetector } from './services/staleness-detector.js';
import { CommitBuilder } from './services/commit-builder.js';
import { SquashMerger } from './services/squash-merger.js';
import { Validator } from './services/validator.js';
import { TerminalPrompt } from './services/terminal-prompt.js';
import { CommitInputResolver } from './services/commit-input-resolver.js';
import { SearchFilter } from './services/search-filter.js';

import { TextFormatter } from './formatters/text-formatter.js';
import { JsonFormatter } from './formatters/json-formatter.js';

import { registerInitCommand } from './commands/init.js';
import { registerContextCommand } from './commands/context.js';
import { registerConstraintsCommand } from './commands/constraints.js';
import { registerRejectedCommand } from './commands/rejected.js';
import { registerDirectivesCommand } from './commands/directives.js';
import { registerTestedCommand } from './commands/tested.js';
import { registerWhyCommand } from './commands/why.js';
import { registerSearchCommand } from './commands/search.js';
import { registerLogCommand } from './commands/log.js';
import { registerStaleCommand } from './commands/stale.js';
import { registerTraceCommand } from './commands/trace.js';
import { registerCommitCommand } from './commands/commit.js';
import { registerValidateCommand } from './commands/validate.js';
import { registerSquashCommand } from './commands/squash.js';
import { registerDoctorCommand } from './commands/doctor.js';

import { LoreError, ValidationError } from './util/errors.js';

/**
 * Composition root: constructs all dependencies and wires them together.
 * This is the ONLY place where concrete implementations are instantiated.
 *
 * SOLID: DIP -- all concrete -> interface wiring happens here.
 * GRASP: Creator -- main.ts creates all service instances.
 */
async function main(): Promise<void> {
  const program = new Command();

  program
    .name('lore')
    .description('CLI tool for the Lore protocol -- structured decision context in git commits')
    .version(version);

  // Global options (display/format only — query flags live on subcommands)
  program
    .option('--json', 'Shorthand for --format json')
    .option('--format <type>', 'Output format: text or json', 'text')
    .option('--no-color', 'Disable colored output');

  // 1. Create concrete implementations
  const gitClient: IGitClient = new GitClient();
  const trailerParser = new TrailerParser();
  const pathResolver = new PathResolver();
  const loreIdGenerator = new LoreIdGenerator();
  const configLoader: IConfigLoader = new ConfigLoader();

  // 2. Load config (best-effort: default if not found)
  let config;
  try {
    config = await configLoader.loadForPath(process.cwd());
  } catch {
    // Fall back to defaults if config can't be loaded
    const { DEFAULT_CONFIG } = await import('./types/config.js');
    config = DEFAULT_CONFIG;
  }

  // 3. Create services that depend on others
  const atomRepository = new AtomRepository(gitClient, trailerParser, config.trailers.custom);
  const supersessionResolver = new SupersessionResolver();
  const stalenessDetector = new StalenessDetector(gitClient, config);
  const commitBuilder = new CommitBuilder(trailerParser, loreIdGenerator, config);
  const squashMerger = new SquashMerger(loreIdGenerator);
  const validator = new Validator(trailerParser, atomRepository, config);
  const searchFilter = new SearchFilter();
  const prompt = new TerminalPrompt();
  const commitInputResolver = new CommitInputResolver(prompt);

  // 4. Formatter factory (reads --format/--json from program options at call time)
  // Memoized: the formatter is created once on first call and reused thereafter.
  let cachedFormatter: IOutputFormatter | null = null;
  const getFormatter = (): IOutputFormatter => {
    if (cachedFormatter !== null) {
      return cachedFormatter;
    }
    const opts = program.opts();
    if (opts.json || opts.format === 'json') {
      cachedFormatter = new JsonFormatter();
    } else {
      cachedFormatter = new TextFormatter({ color: opts.color !== false && (process.stdout.isTTY ?? false) });
    }
    return cachedFormatter;
  };

  // 5. Register all commands with their dependencies

  registerInitCommand(program, { getFormatter });

  const pathQueryDeps = {
    atomRepository,
    supersessionResolver,
    pathResolver,
    getFormatter,
    config,
  };

  registerContextCommand(program, pathQueryDeps);
  registerConstraintsCommand(program, pathQueryDeps);
  registerRejectedCommand(program, pathQueryDeps);
  registerDirectivesCommand(program, pathQueryDeps);
  registerTestedCommand(program, pathQueryDeps);

  registerWhyCommand(program, {
    atomRepository,
    gitClient,
    pathResolver,
    getFormatter,
  });

  registerSearchCommand(program, {
    atomRepository,
    supersessionResolver,
    searchFilter,
    getFormatter,
  });

  registerLogCommand(program, {
    atomRepository,
    supersessionResolver,
    getFormatter,
  });

  registerStaleCommand(program, {
    atomRepository,
    supersessionResolver,
    stalenessDetector,
    pathResolver,
    getFormatter,
  });

  registerTraceCommand(program, {
    atomRepository,
    getFormatter,
  });

  registerCommitCommand(program, {
    commitBuilder,
    gitClient,
    getFormatter,
    commitInputResolver,
  });

  registerValidateCommand(program, {
    validator,
    gitClient,
    getFormatter,
  });

  registerSquashCommand(program, {
    atomRepository,
    squashMerger,
    getFormatter,
  });

  registerDoctorCommand(program, {
    atomRepository,
    configLoader,
    getFormatter,
  });

  // 6. Parse and run
  await program.parseAsync(process.argv);
}

// Top-level error handler
main().catch((error: unknown) => {
  // Determine the formatter for error output
  // We can't use the program opts here since parsing may have failed,
  // so check process.argv directly for --json
  const useJson = process.argv.includes('--json') || process.argv.includes('--format=json');
  const formatter: IOutputFormatter = useJson
    ? new JsonFormatter()
    : new TextFormatter({ color: process.stderr.isTTY ?? false });

  if (error instanceof ValidationError) {
    const messages = error.issues.map((issue) => ({
      severity: issue.severity,
      message: issue.message,
    }));
    const output = formatter.formatError(error.exitCode, messages);
    console.error(output);
    process.exitCode = error.exitCode;
    return;
  }

  if (error instanceof LoreError) {
    const output = formatter.formatError(error.exitCode, [
      { severity: 'error', message: error.message },
    ]);
    console.error(output);
    process.exitCode = error.exitCode;
    return;
  }

  if (error instanceof Error) {
    const output = formatter.formatError(1, [
      { severity: 'error', message: error.message },
    ]);
    console.error(output);
    process.exitCode = 1;
    return;
  }

  console.error('An unexpected error occurred');
  process.exitCode = 1;
});
