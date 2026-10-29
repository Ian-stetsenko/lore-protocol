//! `lore doctor`: health checks for config and the reference graph.
//!
//! 1. Config file exists and parses.
//! 2. Lore-ids are unique.
//! 3. All references resolve.
//! 4. No dependencies on superseded atoms.

use std::collections::{HashMap, HashSet};
use std::path::Path;

use crate::commands::{Io, EXIT_OK};
use crate::interfaces::config_loader::ConfigLoader;
use crate::interfaces::output_formatter::OutputFormatter;
use crate::services::atom_repository::{AtomRepository, FindAllOptions};
use crate::types::domain::{LoreAtom, TrailerKey};
use crate::types::output::{DoctorCheck, DoctorStatus, DoctorSummary, FormattableDoctorResult};
use crate::util::constants::{is_valid_lore_id, EXIT_CODE_VALIDATION_ERROR};
use crate::util::Result;

/// Scan at most this many commits: enough for most repos while bounding runtime.
const MAX_COMMITS: usize = 10_000;

pub struct DoctorDeps<'a> {
    pub atom_repository: &'a AtomRepository<'a>,
    pub config_loader: &'a dyn ConfigLoader,
    pub formatter: &'a dyn OutputFormatter,
    /// Directory the config lookup starts from (the process cwd in production).
    pub cwd: &'a Path,
}

pub fn run(deps: &DoctorDeps<'_>, io: &mut Io<'_>) -> Result<i32> {
    let mut checks: Vec<DoctorCheck> = vec![check_config(deps.config_loader, deps.cwd)];

    let all_atoms: Vec<LoreAtom> = match deps.atom_repository.find_all(&FindAllOptions {
        max_commits: Some(MAX_COMMITS),
        ..FindAllOptions::default()
    }) {
        Ok(atoms) => atoms,
        Err(_) => {
            checks.push(DoctorCheck {
                name: "Atom retrieval".to_owned(),
                status: DoctorStatus::Error,
                message: "Failed to retrieve atoms from git history".to_owned(),
                details: Vec::new(),
            });
            Vec::new()
        }
    };

    checks.push(check_lore_id_uniqueness(&all_atoms));
    checks.push(check_references_resolve(&all_atoms));
    checks.push(check_orphaned_dependencies(&all_atoms));

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

fn check_lore_id_uniqueness(atoms: &[LoreAtom]) -> DoctorCheck {
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
            name: "Lore-id uniqueness".to_owned(),
            status: DoctorStatus::Warning,
            message: format!("{} duplicate Lore-id(s) found", duplicates.len()),
            details: duplicates,
        };
    }

    DoctorCheck {
        name: "Lore-id uniqueness".to_owned(),
        status: DoctorStatus::Ok,
        message: format!("All {} Lore-ids are unique", atoms.len()),
        details: Vec::new(),
    }
}

fn check_references_resolve(atoms: &[LoreAtom]) -> DoctorCheck {
    let all_ids: HashSet<&str> = atoms.iter().map(|a| a.lore_id.as_str()).collect();
    let mut broken: Vec<String> = Vec::new();

    for atom in atoms {
        for key in TrailerKey::REFERENCE {
            let Some(refs) = atom.trailers.array_values(key) else {
                continue;
            };
            for ref_id in refs {
                if is_valid_lore_id(ref_id) && !all_ids.contains(ref_id.as_str()) {
                    broken.push(format!(
                        "Lore-id \"{ref_id}\" referenced by {} ({key}) not found",
                        atom.lore_id
                    ));
                }
            }
        }
    }

    if !broken.is_empty() {
        return DoctorCheck {
            name: "Reference resolution".to_owned(),
            status: DoctorStatus::Warning,
            message: format!("{} broken reference(s) found", broken.len()),
            details: broken,
        };
    }

    DoctorCheck {
        name: "Reference resolution".to_owned(),
        status: DoctorStatus::Ok,
        message: "All references resolve to existing atoms".to_owned(),
        details: Vec::new(),
    }
}

fn check_orphaned_dependencies(atoms: &[LoreAtom]) -> DoctorCheck {
    let superseded_ids: HashSet<&str> = atoms
        .iter()
        .flat_map(|a| a.trailers.supersedes.iter())
        .filter(|id| is_valid_lore_id(id))
        .map(String::as_str)
        .collect();

    let orphaned: Vec<String> = atoms
        .iter()
        .flat_map(|atom| {
            atom.trailers
                .depends_on
                .iter()
                .filter(|dep| is_valid_lore_id(dep) && superseded_ids.contains(dep.as_str()))
                .map(move |dep| {
                    format!(
                        "Atom {} depends on {dep}, which has been superseded",
                        atom.lore_id
                    )
                })
        })
        .collect();

    if !orphaned.is_empty() {
        return DoctorCheck {
            name: "Orphaned dependencies".to_owned(),
            status: DoctorStatus::Info,
            message: format!("{} atom(s) depend on superseded atoms", orphaned.len()),
            details: orphaned,
        };
    }

    DoctorCheck {
        name: "Orphaned dependencies".to_owned(),
        status: DoctorStatus::Ok,
        message: "No orphaned dependencies found".to_owned(),
        details: Vec::new(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::atom;

    #[test]
    fn uniqueness_reports_duplicates_in_first_seen_order() {
        let atoms = vec![
            atom().id("aaaa1111").build(),
            atom().id("bbbb2222").build(),
            atom().id("aaaa1111").build(),
            atom().id("bbbb2222").build(),
            atom().id("bbbb2222").build(),
        ];
        let check = check_lore_id_uniqueness(&atoms);
        assert_eq!(check.status, DoctorStatus::Warning);
        assert_eq!(check.message, "2 duplicate Lore-id(s) found");
        assert_eq!(
            check.details,
            vec![
                "Lore-id \"aaaa1111\" appears 2 times",
                "Lore-id \"bbbb2222\" appears 3 times"
            ]
        );
        let ok = check_lore_id_uniqueness(&atoms[..2]);
        assert_eq!(ok.status, DoctorStatus::Ok);
        assert_eq!(ok.message, "All 2 Lore-ids are unique");
    }

    #[test]
    fn references_and_orphans_are_detected() {
        let atoms = vec![
            atom().id("aaaa1111").build(),
            atom()
                .id("bbbb2222")
                .supersedes(&["aaaa1111"])
                .related(&["ffff9999", "not-an-id"])
                .build(),
            atom().id("cccc3333").depends_on(&["aaaa1111"]).build(),
        ];
        let refs = check_references_resolve(&atoms);
        assert_eq!(refs.status, DoctorStatus::Warning);
        assert_eq!(
            refs.details,
            vec!["Lore-id \"ffff9999\" referenced by bbbb2222 (Related) not found"]
        );
        let orphans = check_orphaned_dependencies(&atoms);
        assert_eq!(orphans.status, DoctorStatus::Info);
        assert_eq!(
            orphans.details,
            vec!["Atom cccc3333 depends on aaaa1111, which has been superseded"]
        );
        assert_eq!(
            check_references_resolve(&atoms[..1]).status,
            DoctorStatus::Ok
        );
        assert_eq!(
            check_orphaned_dependencies(&atoms[..1]).status,
            DoctorStatus::Ok
        );
    }
}
