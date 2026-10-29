//! `lore stale [target]`: flag potentially outdated knowledge.

use crate::cli::StaleArgs;
use crate::commands::{Io, EXIT_OK};
use crate::interfaces::output_formatter::OutputFormatter;
use crate::services::atom_repository::{AtomRepository, FindAllOptions};
use crate::services::path_resolver::PathResolver;
use crate::services::staleness_detector::StalenessDetector;
use crate::services::supersession_resolver::SupersessionResolver;
use crate::types::output::{FormattableStalenessResult, StaleSignal};
use crate::types::query::PathQueryOptions;
use crate::util::Result;

pub struct StaleDeps<'a> {
    pub atom_repository: &'a AtomRepository<'a>,
    pub supersession_resolver: &'a SupersessionResolver,
    pub staleness_detector: &'a StalenessDetector<'a>,
    pub path_resolver: &'a PathResolver,
    pub formatter: &'a dyn OutputFormatter,
}

pub fn run(args: &StaleArgs, deps: &StaleDeps<'_>, io: &mut Io<'_>) -> Result<i32> {
    let atoms = match args.target.as_deref().filter(|t| !t.is_empty()) {
        Some(target) => {
            let parsed = deps.path_resolver.parse_target(target);
            let git_log_args = deps.path_resolver.to_git_log_args(&parsed);
            deps.atom_repository
                .find_by_target(&git_log_args, &PathQueryOptions::default())?
        }
        None => deps.atom_repository.find_all(&FindAllOptions::default())?,
    };

    // Supersession for dependency-orphan detection; stale checks only make
    // sense for active atoms.
    let supersession_map = deps.supersession_resolver.resolve(&atoms);
    let active_atoms = deps
        .supersession_resolver
        .filter_active(&atoms, &supersession_map);

    let mut reports = deps
        .staleness_detector
        .analyze(&active_atoms, &supersession_map);

    // CLI-level filters: keep reports matching ANY requested signal.
    let mut active_signals: Vec<StaleSignal> = Vec::new();
    if args.older_than.as_deref().is_some_and(|v| !v.is_empty()) {
        active_signals.push(StaleSignal::Age);
    }
    if args.drift.is_some() {
        active_signals.push(StaleSignal::Drift);
    }
    if args.low_confidence {
        active_signals.push(StaleSignal::LowConfidence);
    }
    if !active_signals.is_empty() {
        reports.retain(|r| {
            r.reasons
                .iter()
                .any(|reason| active_signals.contains(&reason.signal))
        });
    }

    let result = FormattableStalenessResult { atoms: reports };
    io.print(&deps.formatter.format_staleness_result(&result))?;
    Ok(EXIT_OK)
}
