//! `lore doctor`: health checks for config and the reference graph.
//!
//! 1. Config file exists and parses.
//! 2. Lore-ids are unique (across every ref with `--all`).
//! 3. All references resolve, across every ref: dangling Supersedes /
//!    Depends-on are warnings, dangling Related are info.
//! 4. No dependencies on superseded atoms without a live successor.

use std::collections::{HashMap, HashSet};
use std::path::Path;

use crate::cli::DoctorArgs;
use crate::commands::{Io, EXIT_OK};
use crate::interfaces::config_loader::ConfigLoader;
use crate::interfaces::output_formatter::OutputFormatter;
use crate::services::atom_repository::{AtomRepository, FindAllOptions};
use crate::services::supersession_resolver::SupersessionResolver;
use crate::types::domain::{LoreAtom, SupersessionStatus, TrailerKey};
use crate::types::output::{DoctorCheck, DoctorStatus, DoctorSummary, FormattableDoctorResult};
use crate::util::constants::{is_valid_lore_id, EXIT_CODE_VALIDATION_ERROR};
use crate::util::Result;

/// Atom scan limit for health checks, bounding runtime on large repos.
const DOCTOR_SCAN_LIMIT: usize = 10_000;

pub struct DoctorDeps<'a> {
    pub atom_repository: &'a AtomRepository<'a>,
    pub config_loader: &'a dyn ConfigLoader,
    pub formatter: &'a dyn OutputFormatter,
    pub supersession_resolver: &'a SupersessionResolver,
    /// Directory the config lookup starts from (the process cwd in production).
    pub cwd: &'a Path,
}

pub fn run(args: &DoctorArgs, deps: &DoctorDeps<'_>, io: &mut Io<'_>) -> Result<i32> {
    let mut checks: Vec<DoctorCheck> = vec![check_config(deps.config_loader, deps.cwd)];

    let (all_atoms, uniqueness_atoms) = match scan_atoms(deps.atom_repository, args.all) {
        Ok(scanned) => scanned,
        Err(_) => {
            checks.push(DoctorCheck {
                name: "Atom retrieval".to_owned(),
                status: DoctorStatus::Error,
                message: "Failed to retrieve atoms from git history".to_owned(),
                details: Vec::new(),
            });
            (Vec::new(), Vec::new())
        }
    };

    checks.push(check_lore_id_uniqueness(&uniqueness_atoms, args.all));
    checks.extend(check_references_resolve(&all_atoms, deps.atom_repository));
    checks.push(check_superseded_dependencies(
        &all_atoms,
        deps.supersession_resolver,
    ));

    let mut summary = DoctorSummary::default();
    for check in &checks {
        match check.status {
            DoctorStatus::Error => summary.errors += 1,
            DoctorStatus::Warning => summary.warnings += 1,
            DoctorStatus::Info => summary.info += 1,
            DoctorStatus::Ok => {}
        }
    }

    let result = FormattableDoctorResult { checks, summary };
    io.print(&deps.formatter.format_doctor_result(&result))?;

    Ok(if summary.errors > 0 {
        EXIT_CODE_VALIDATION_ERROR
    } else {
        EXIT_OK
    })
}

/// Atoms on the current branch, plus the atoms the uniqueness check scans.
///
/// `all_refs` opts the uniqueness check into scanning every ref: a Lore-id
/// shared with a side branch (e.g. a future-dated poison commit) surfaces
/// only there. Off by default because backup branches make cross-ref
/// duplicates noisy (issue #57).
fn scan_atoms(
    repository: &AtomRepository<'_>,
    all_refs: bool,
) -> Result<(Vec<LoreAtom>, Vec<LoreAtom>)> {
    let scan = |all_refs| {
        repository.find_all(&FindAllOptions {
            max_commits: Some(DOCTOR_SCAN_LIMIT),
            all_refs,
            ..FindAllOptions::default()
        })
    };
    let branch_atoms = scan(false)?;
    let uniqueness_atoms = if all_refs {
        scan(true)?
    } else {
        branch_atoms.clone()
    };
    Ok((branch_atoms, uniqueness_atoms))
}

fn check_config(config_loader: &dyn ConfigLoader, cwd: &Path) -> DoctorCheck {
    let name = "Config file".to_owned();
    let found = match config_loader.find_config_path(cwd) {
        Ok(found) => found,
        Err(err) => return config_error(name, &err.to_string()),
    };
    let Some(config_path) = found else {
        return DoctorCheck {
            name,
            status: DoctorStatus::Warning,
            message: "No .lore/config.toml found. Run `lore init` to create one.".to_owned(),
            details: Vec::new(),
        };
    };
    match config_loader.load_from_file(&config_path) {
        Ok(_) => DoctorCheck {
            name,
            status: DoctorStatus::Ok,
            message: format!("Found and parsed {}", config_path.display()),
            details: Vec::new(),
        },
        Err(err) => config_error(name, &err.to_string()),
    }
}

fn config_error(name: String, err: &str) -> DoctorCheck {
    DoctorCheck {
        name,
        status: DoctorStatus::Error,
        message: format!("Failed to parse config: {err}"),
        details: Vec::new(),
    }
}

fn check_lore_id_uniqueness(atoms: &[LoreAtom], all_refs: bool) -> DoctorCheck {
    let name = if all_refs {
        "Lore-id uniqueness (all refs)"
    } else {
        "Lore-id uniqueness"
    };
    // Count in first-seen order so duplicate reports are deterministic.
    let mut order: Vec<&str> = Vec::new();
    let mut counts: HashMap<&str, usize> = HashMap::new();
    for atom in atoms {
        let count = counts.entry(&atom.lore_id).or_insert(0);
        if *count == 0 {
            order.push(&atom.lore_id);
        }
        *count += 1;
    }

    let duplicates: Vec<String> = order
        .iter()
        .filter_map(|id| {
            let count = counts.get(id).copied().unwrap_or(0);
            (count > 1).then(|| format!("Lore-id \"{id}\" appears {count} times"))
        })
        .collect();

    if !duplicates.is_empty() {
        return DoctorCheck {
            name: name.to_owned(),
            status: DoctorStatus::Warning,
            message: format!("{} duplicate Lore-id(s) found", duplicates.len()),
            details: duplicates,
        };
    }

    DoctorCheck {
        name: name.to_owned(),
        status: DoctorStatus::Ok,
        message: format!("All {} Lore-ids are unique", atoms.len()),
        details: Vec::new(),
    }
}

/// A reference id cited by a scanned atom.
struct ReferenceEntry<'a> {
    key: TrailerKey,
    ref_id: &'a str,
    atom_id: &'a str,
}

impl ReferenceEntry<'_> {
    fn detail(&self) -> String {
        format!(
            "Lore-id \"{}\" referenced by {} ({}) not found",
            self.ref_id, self.atom_id, self.key
        )
    }
}

const WARNING_REFERENCES_CHECK: &str = "Reference resolution (supersedes/depends-on)";
const RELATED_REFERENCES_CHECK: &str = "Reference resolution (related)";

/// Reference checks split by severity: dangling Supersedes / Depends-on is
/// a warning (always reported), dangling Related is info (reported only
/// with findings).
///
/// Ids resolve through the shared all-refs Lore-id index rather than the
/// scanned atoms, so an id living only on a side branch is not dangling.
/// The index is built only when a scanned atom cites a reference; if it
/// cannot be built a single "skipped" warning replaces both checks.
fn check_references_resolve(
    atoms: &[LoreAtom],
    repository: &AtomRepository<'_>,
) -> Vec<DoctorCheck> {
    let entries: Vec<ReferenceEntry<'_>> = atoms
        .iter()
        .flat_map(|atom| {
            TrailerKey::REFERENCE.iter().flat_map(move |key| {
                atom.trailers
                    .array_values(*key)
                    .into_iter()
                    .flatten()
                    .filter(|ref_id| is_valid_lore_id(ref_id))
                    .map(move |ref_id| ReferenceEntry {
                        key: *key,
                        ref_id,
                        atom_id: &atom.lore_id,
                    })
            })
        })
        .collect();

    if entries.is_empty() {
        return vec![all_references_resolve()];
    }

    let Ok(index) = repository.lore_id_index() else {
        return vec![DoctorCheck {
            name: "Reference resolution (skipped)".to_owned(),
            status: DoctorStatus::Warning,
            message: "reference check skipped: Lore-id index unavailable".to_owned(),
            details: Vec::new(),
        }];
    };

    let (related, warning): (Vec<_>, Vec<_>) = entries
        .iter()
        .filter(|entry| !index.contains_key(entry.ref_id))
        .partition(|entry| entry.key == TrailerKey::Related);

    let mut checks = vec![if warning.is_empty() {
        all_references_resolve()
    } else {
        DoctorCheck {
            name: WARNING_REFERENCES_CHECK.to_owned(),
            status: DoctorStatus::Warning,
            message: format!("{} broken reference(s) found", warning.len()),
            details: warning.iter().map(|entry| entry.detail()).collect(),
        }
    }];
    if !related.is_empty() {
        checks.push(DoctorCheck {
            name: RELATED_REFERENCES_CHECK.to_owned(),
            status: DoctorStatus::Info,
            message: format!("{} broken related reference(s) found", related.len()),
            details: related.iter().map(|entry| entry.detail()).collect(),
        });
    }
    checks
}

fn all_references_resolve() -> DoctorCheck {
    DoctorCheck {
        name: WARNING_REFERENCES_CHECK.to_owned(),
        status: DoctorStatus::Ok,
        message: "All references resolve to existing atoms".to_owned(),
        details: Vec::new(),
    }
}

/// Depends-on edges whose target is superseded with no live successor.
///
/// A supersede carries the decision forward, dependencies included, so an
/// edge whose target's supersession chain reaches a live atom is satisfied
/// and stays silent. Targets absent from the scanned set are the reference
/// check's business, not this one's.
fn check_superseded_dependencies(
    atoms: &[LoreAtom],
    supersession_resolver: &SupersessionResolver,
) -> DoctorCheck {
    let supersession_map = supersession_resolver.resolve(atoms);

    let flagged: Vec<String> = atoms
        .iter()
        .flat_map(|atom| {
            atom.trailers
                .depends_on
                .iter()
                .filter(|dep| is_valid_lore_id(dep) && supersession_map.contains_key(dep.as_str()))
                .filter(|dep| !chain_reaches_live_atom(dep, &supersession_map))
                .map(move |dep| {
                    format!(
                        "Atom {} depends on {dep}, which has been superseded",
                        atom.lore_id
                    )
                })
        })
        .collect();

    if !flagged.is_empty() {
        return DoctorCheck {
            name: "Superseded dependencies".to_owned(),
            status: DoctorStatus::Info,
            message: format!("{} atom(s) depend on superseded atoms", flagged.len()),
            details: flagged,
        };
    }

    DoctorCheck {
        name: "Superseded dependencies".to_owned(),
        status: DoctorStatus::Ok,
        message: "No superseded dependencies found".to_owned(),
        details: Vec::new(),
    }
}

/// Whether `start_id`'s supersession chain ends at a live (not superseded)
/// atom. Carries its own visited set, so a chain that cycles without
/// reaching a live atom (self-supersession included) terminates and counts
/// as unresolved, as does a successor missing from the scanned set.
fn chain_reaches_live_atom(
    start_id: &str,
    supersession_map: &HashMap<String, SupersessionStatus>,
) -> bool {
    let mut visited: HashSet<&str> = HashSet::new();
    let mut current = Some(start_id);
    while let Some(id) = current {
        if !visited.insert(id) {
            return false; // cycle without a live atom
        }
        let Some(status) = supersession_map.get(id) else {
            return false; // successor absent from the scanned set
        };
        if !status.superseded {
            return true;
        }
        current = status.superseded_by.as_deref();
    }
    false
}

#[cfg(test)]
mod tests;
