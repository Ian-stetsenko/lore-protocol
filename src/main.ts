import { Command } from 'commander';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const simpleUpdateNotifier = require('simple-update-notifier');
const pkg = require('../package.json');
const { version } = pkg;

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
import { HeadLoreIdReader } from './services/head-lore-id-reader.js';
import { SearchFilter } from './services/search-filter.js';
import { Protocol } from './services/protocol.js';

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
import { registerConfigCommand } from './commands/config.js';

import { LoreError, ValidationError } from './util/errors.js';
import { shouldCheckForUpdate } from './util/update-check.js';

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
    .option('--no-color', 'Disable colored output')
    .option('--no-update-notifier', 'Disable update notification');

  // 1. Create concrete implementations
  const gitClient: IGitClient = new GitClient();
  const pathResolver = new PathResolver();
  const loreIdGenerator = new LoreIdGenerator();
  const configLoader: IConfigLoader = new ConfigLoader();

  // 2. Load config (best-effort: default if not found)
  let config;
  try {
    config = await configLoader.loadForPath(process.cwd());
  } catch {
    // Fall back to defaults if config can't be loaded
    const { DEFAULT_CONFIG } = await import('./util/constants.js');
    config = DEFAULT_CONFIG;
  }

  // 3. Update notification (fire-and-forget, respects env vars and config)
  if (shouldCheckForUpdate(config.cli.updateCheck)) {
    simpleUpdateNotifier({ pkg }).catch(() => {});
  }

  // 4. Create services that depend on others
  const protocol = new Protocol(config);
  const trailerParser = new TrailerParser(protocol);
  const atomRepository = new AtomRepository(gitClient, trailerParser, protocol);
  const supersessionResolver = new SupersessionResolver();
  const stalenessDetector = new StalenessDetector(gitClient, config);
  const commitBuilder = new CommitBuilder(trailerParser, loreIdGenerator, config, protocol);
  const squashMerger = new SquashMerger(loreIdGenerator, protocol);
  const validator = new Validator(trailerParser, atomRepository, config, protocol);
  const searchFilter = new SearchFilter();
  const prompt = new TerminalPrompt();
  const commitInputResolver = new CommitInputResolver(prompt, protocol);
  const headLoreIdReader = new HeadLoreIdReader(gitClient, trailerParser);

  // 5. Formatter factory (reads --format/--json from program options at call time)
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

  // 6. Register all commands with their dependencies

  registerInitCommand(program, { getFormatter });

  const pathQueryDeps = {
    atomRepository,
    supersessionResolver,
    pathResolver,
    getFormatter,
    config,
    protocol,
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
    protocol,
  });

  registerSearchCommand(program, {
    atomRepository,
    supersessionResolver,
    searchFilter,
    getFormatter,
    config,
    protocol,
  });

  registerLogCommand(program, {
    atomRepository,
    supersessionResolver,
    getFormatter,
    config,
    protocol,
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
    protocol,
  });

  registerCommitCommand(program, {
    commitBuilder,
    gitClient,
    getFormatter,
    commitInputResolver,
    headLoreIdReader,
    config,
    protocol,
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
    protocol,
  });

  registerConfigCommand(program, {
    configLoader,
    getFormatter,
    protocol,
  });

  // 7. Parse and run
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
      field: issue.field,
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
