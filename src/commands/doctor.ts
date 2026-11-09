import type { Command } from 'commander';
import type { AtomRepository } from '../services/atom-repository.js';
import type { SupersessionResolver } from '../services/supersession-resolver.js';
import type { IConfigLoader } from '../interfaces/config-loader.js';
import type { IOutputFormatter } from '../interfaces/output-formatter.js';
import type { FormattableDoctorResult, DoctorCheck } from '../types/output.js';
import type { LoreAtom, LoreId, SupersessionStatus } from '../types/domain.js';
import { LORE_ID_PATTERN, REFERENCE_TRAILER_KEYS } from '../util/constants.js';

/** Atom scan limit for health checks, bounding runtime on large repos. */
const DOCTOR_SCAN_LIMIT = 10_000;

/**
 * Register the `lore doctor` command.
 * Runs health checks:
 * 1. Config file exists and is valid
 * 2. Lore-id uniqueness
 * 3. All references resolve
 * 4. No superseded dependencies
 */
export function registerDoctorCommand(
  program: Command,
  deps: {
    atomRepository: AtomRepository;
    configLoader: IConfigLoader;
    getFormatter: () => IOutputFormatter;
    supersessionResolver: SupersessionResolver;
  },
): void {
  program
    .command('doctor')
    .description('Health check: broken refs, config issues')
    .option('--all', 'Check Lore-id uniqueness across all refs, not just the current branch')
    .action(async (options: { all?: boolean }) => {
      const { atomRepository, configLoader, getFormatter, supersessionResolver } = deps;

      const checks: DoctorCheck[] = [];

      // Check 1: Config file exists and is valid
      checks.push(await checkConfig(configLoader));

      // Get all atoms for remaining checks
      let allAtoms: LoreAtom[];
      let uniquenessAtoms: LoreAtom[];
      try {
        // Scan up to 10k commits — enough for most repos while bounding runtime
        allAtoms = await atomRepository.findAll({ maxCommits: DOCTOR_SCAN_LIMIT });
        // --all opts the uniqueness check into scanning every ref: a Lore-id
        // shared with a side branch (e.g. a future-dated poison commit)
        // surfaces only there. Off by default because backup branches make
        // cross-ref duplicates noisy (issue #57).
        uniquenessAtoms = options.all
          ? await atomRepository.findAll({ maxCommits: DOCTOR_SCAN_LIMIT, allRefs: true })
          : allAtoms;
      } catch {
        checks.push({
          name: 'Atom retrieval',
          status: 'error',
          message: 'Failed to retrieve atoms from git history',
          details: [],
        });
        allAtoms = [];
        uniquenessAtoms = [];
      }

      // Check 2: Lore-id uniqueness
      checks.push(checkLoreIdUniqueness(uniquenessAtoms, options.all === true));

      // Check 3: All references resolve
      checks.push(...(await checkReferencesResolve(allAtoms, atomRepository)));

      // Check 4: Superseded dependencies (transferred dependencies stay silent)
      checks.push(checkSupersededDependencies(allAtoms, supersessionResolver));

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
  allRefs = false,
): DoctorCheck {
  const name = allRefs ? 'Lore-id uniqueness (all refs)' : 'Lore-id uniqueness';
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
      name,
      status: 'warning',
      message: `${duplicates.length} duplicate Lore-id(s) found`,
      details: duplicates,
    };
  }

  return {
    name,
    status: 'ok',
    message: `All ${atoms.length} Lore-ids are unique`,
    details: [],
  };
}

async function checkReferencesResolve(
  atoms: readonly LoreAtom[],
  atomRepository: AtomRepository,
): Promise<readonly DoctorCheck[]> {
  const refEntries: { key: string; refId: string; atomId: string }[] = [];

  for (const atom of atoms) {
    for (const key of REFERENCE_TRAILER_KEYS) {
      const refs = atom.trailers[key] as readonly string[];
      for (const refId of refs) {
        if (LORE_ID_PATTERN.test(refId)) {
          refEntries.push({ key, refId, atomId: atom.loreId });
        }
      }
    }
  }

  // Warning-severity class: dangling Supersedes/Depends-on references.
  // Always present; its ok message is the reference check's clean output.
  const warningOk: DoctorCheck = {
    name: 'Reference resolution (supersedes/depends-on)',
    status: 'ok',
    message: 'All references resolve to existing atoms',
    details: [],
  };

  if (refEntries.length === 0) {
    return [warningOk];
  }

  // Resolve against the shared all-refs index (HEAD-first, per
  // findByLoreId) instead of the scanned atom set: an id living only on a
  // side branch is a valid reference, not a broken one. Guard mirrors the
  // validator's (validIds.length > 0 ? await getLoreIdIndex() : null):
  // reference-free corpora never pay the index build.
  let index: ReadonlyMap<string, LoreAtom>;
  try {
    index = await atomRepository.getLoreIdIndex();
  } catch {
    // Failure policy: one dedicated warning-status check, fixed message,
    // no per-reference details. Never an error status and never an
    // unhandled rejection; the remaining checks still run.
    return [
      {
        name: 'Reference resolution (skipped)',
        status: 'warning',
        message: 'reference check skipped: Lore-id index unavailable',
        details: [],
      },
    ];
  }

  const brokenEntries = refEntries.filter(({ refId }) => !index.has(refId));
  const formatDetail = ({
    refId,
    atomId,
    key,
  }: {
    refId: string;
    atomId: string;
    key: string;
  }): string => `Lore-id "${refId}" referenced by ${atomId} (${key}) not found`;

  const relatedBroken = brokenEntries.filter(({ key }) => key === 'Related');
  const warningBroken = brokenEntries.filter(({ key }) => key !== 'Related');

  const warningCheck: DoctorCheck =
    warningBroken.length > 0
      ? {
          name: 'Reference resolution (supersedes/depends-on)',
          status: 'warning',
          message: `${warningBroken.length} broken reference(s) found`,
          details: warningBroken.map(formatDetail),
        }
      : warningOk;

  const checks: DoctorCheck[] = [warningCheck];
  // Info-severity class: dangling Related references. Pushed only when it
  // has findings, so a clean corpus prints no empty info line.
  if (relatedBroken.length > 0) {
    checks.push({
      name: 'Reference resolution (related)',
      status: 'info',
      message: `${relatedBroken.length} broken related reference(s) found`,
      details: relatedBroken.map(formatDetail),
    });
  }
  return checks;
}

function checkSupersededDependencies(
  atoms: readonly LoreAtom[],
  supersessionResolver: SupersessionResolver,
): DoctorCheck {
  // Subtractive: consume the shared resolver's supersession map over the
  // scanned atom set. An edge whose target has been transferred to a live
  // successor is satisfied and stays silent.
  const supersessionMap: ReadonlyMap<string, SupersessionStatus> =
    supersessionResolver.resolve(atoms);

  const flagged: string[] = [];
  for (const atom of atoms) {
    for (const depId of atom.trailers['Depends-on']) {
      if (!LORE_ID_PATTERN.test(depId)) {
        continue;
      }
      // Absent targets never had a supersession status: missing targets
      // are the reference-resolution check's business, not this one's.
      if (!supersessionMap.has(depId)) {
        continue;
      }
      if (chainReachesLiveAtom(depId, supersessionMap)) {
        continue; // transferred, directly or through a chain, to a live atom
      }
      flagged.push(
        `Atom ${atom.loreId} depends on ${depId}, which has been superseded`,
      );
    }
  }

  if (flagged.length > 0) {
    return {
      name: 'Superseded dependencies',
      status: 'info',
      message: `${flagged.length} atom(s) depend on superseded atoms`,
      details: flagged,
    };
  }

  return {
    name: 'Superseded dependencies',
    status: 'ok',
    message: 'No superseded dependencies found',
    details: [],
  };
}

/**
 * Follow a dependency target's supersession chain: satisfied (true) when
 * the chain terminates at a live — not superseded — atom, unresolved
 * (false) otherwise. Carries its own visited set (the resolver's visited
 * set only protects map construction), so a chain that cycles without
 * reaching a live atom — self-supersession included — terminates safely
 * and counts as unresolved.
 */
function chainReachesLiveAtom(
  startId: LoreId,
  supersessionMap: ReadonlyMap<string, SupersessionStatus>,
): boolean {
  const visited = new Set<string>();
  let currentId: LoreId | null = startId;
  while (currentId !== null) {
    if (visited.has(currentId)) {
      return false; // cycle without a live atom
    }
    visited.add(currentId);

    const status = supersessionMap.get(currentId);
    if (status === undefined) {
      return false; // defensive: successor absent from the scanned set
    }
    if (!status.superseded) {
      return true; // chain terminated at a live atom
    }
    currentId = status.supersededBy;
  }
  return false;
}
