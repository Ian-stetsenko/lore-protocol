import type { Command } from 'commander';
import type { AtomRepository } from '../services/atom-repository.js';
import type { IConfigLoader } from '../interfaces/config-loader.js';
import type { IOutputFormatter } from '../interfaces/output-formatter.js';
import type { FormattableDoctorResult, DoctorCheck } from '../types/output.js';
import type { LoreAtom } from '../types/domain.js';
import { LORE_ID_PATTERN, REFERENCE_TRAILER_KEYS } from '../util/constants.js';

/**
 * Register the `lore doctor` command.
 * Runs health checks:
 * 1. Config file exists and is valid
 * 2. Lore-id uniqueness
 * 3. All references resolve
 * 4. No orphaned dependencies
 */
export function registerDoctorCommand(
  program: Command,
  deps: {
    atomRepository: AtomRepository;
    configLoader: IConfigLoader;
    getFormatter: () => IOutputFormatter;
  },
): void {
  program
    .command('doctor')
    .description('Health check: broken refs, config issues')
    .action(async () => {
      const { atomRepository, configLoader, getFormatter } = deps;

      const checks: DoctorCheck[] = [];

      // Check 1: Config file exists and is valid
      checks.push(await checkConfig(configLoader));

      // Get all atoms for remaining checks
      let allAtoms: LoreAtom[];
      try {
        allAtoms = await atomRepository.findAll({ limit: 10000 });
      } catch {
        checks.push({
          name: 'Atom retrieval',
          status: 'error',
          message: 'Failed to retrieve atoms from git history',
          details: [],
        });
        allAtoms = [];
      }

      // Check 2: Lore-id uniqueness
      checks.push(checkLoreIdUniqueness(allAtoms));

      // Check 3: All references resolve
      checks.push(checkReferencesResolve(allAtoms));

      // Check 4: Orphaned dependencies (depends on superseded atoms)
      checks.push(checkOrphanedDependencies(allAtoms));

      // Compute summary
      let errors = 0;
      let warnings = 0;
      let info = 0;

      for (const check of checks) {
        switch (check.status) {
          case 'error':
            errors++;
            break;
          case 'warning':
            warnings++;
            break;
          case 'info':
            info++;
            break;
        }
      }

      const doctorResult: FormattableDoctorResult = {
        checks,
        summary: { errors, warnings, info },
      };

      const formatter = getFormatter();
      console.log(formatter.formatDoctorResult(doctorResult));

      if (errors > 0) {
        process.exitCode = 1;
      }
    });
}

async function checkConfig(configLoader: IConfigLoader): Promise<DoctorCheck> {
  try {
    const configPath = await configLoader.findConfigPath(process.cwd());
    if (configPath === null) {
      return {
        name: 'Config file',
        status: 'warning',
        message: 'No .lore/config.toml found. Run `lore init` to create one.',
        details: [],
      };
    }

    await configLoader.loadFromFile(configPath);
    return {
      name: 'Config file',
      status: 'ok',
      message: `Found and parsed ${configPath}`,
      details: [],
    };
  } catch (err) {
    return {
      name: 'Config file',
      status: 'error',
      message: `Failed to parse config: ${err instanceof Error ? err.message : String(err)}`,
      details: [],
    };
  }
}

function checkLoreIdUniqueness(
  atoms: readonly LoreAtom[],
): DoctorCheck {
  const idCounts = new Map<string, number>();

  for (const atom of atoms) {
    const count = idCounts.get(atom.loreId) ?? 0;
    idCounts.set(atom.loreId, count + 1);
  }

  const duplicates: string[] = [];
  for (const [id, count] of idCounts) {
    if (count > 1) {
      duplicates.push(`Lore-id "${id}" appears ${count} times`);
    }
  }

  if (duplicates.length > 0) {
    return {
      name: 'Lore-id uniqueness',
      status: 'warning',
      message: `${duplicates.length} duplicate Lore-id(s) found`,
      details: duplicates,
    };
  }

  return {
    name: 'Lore-id uniqueness',
    status: 'ok',
    message: `All ${atoms.length} Lore-ids are unique`,
    details: [],
  };
}

function checkReferencesResolve(
  atoms: readonly LoreAtom[],
): DoctorCheck {
  const allLoreIds = new Set(atoms.map((a) => a.loreId));
  const brokenRefs: string[] = [];

  for (const atom of atoms) {
    for (const key of REFERENCE_TRAILER_KEYS) {
      const refs = atom.trailers[key] as readonly string[];
      for (const refId of refs) {
        if (LORE_ID_PATTERN.test(refId) && !allLoreIds.has(refId)) {
          brokenRefs.push(
            `Lore-id "${refId}" referenced by ${atom.loreId} (${key}) not found`,
          );
        }
      }
    }
  }

  if (brokenRefs.length > 0) {
    return {
      name: 'Reference resolution',
      status: 'warning',
      message: `${brokenRefs.length} broken reference(s) found`,
      details: brokenRefs,
    };
  }

  return {
    name: 'Reference resolution',
    status: 'ok',
    message: 'All references resolve to existing atoms',
    details: [],
  };
}

function checkOrphanedDependencies(
  atoms: readonly LoreAtom[],
): DoctorCheck {
  // Build a supersession set: atoms that are superseded
  const supersededIds = new Set<string>();
  for (const atom of atoms) {
    for (const supersededId of atom.trailers.Supersedes) {
      if (LORE_ID_PATTERN.test(supersededId)) {
        supersededIds.add(supersededId);
      }
    }
  }

  const orphaned: string[] = [];
  for (const atom of atoms) {
    for (const depId of atom.trailers['Depends-on']) {
      if (LORE_ID_PATTERN.test(depId) && supersededIds.has(depId)) {
        orphaned.push(
          `Atom ${atom.loreId} depends on ${depId}, which has been superseded`,
        );
      }
    }
  }

  if (orphaned.length > 0) {
    return {
      name: 'Orphaned dependencies',
      status: 'info',
      message: `${orphaned.length} atom(s) depend on superseded atoms`,
      details: orphaned,
    };
  }

  return {
    name: 'Orphaned dependencies',
    status: 'ok',
    message: 'No orphaned dependencies found',
    details: [],
  };
}
