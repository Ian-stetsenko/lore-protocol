//! `lore why <file:line[-line]>`: decision context for specific lines.
//!
//! Uses git blame to find the commit for each line, then looks up only
//! those commits (one `git log -1` per unique hash) rather than loading all
//! atoms from history.

use std::collections::{HashMap, HashSet};

use crate::cli::WhyArgs;
use crate::commands::helpers::build_query_meta::build_query_meta;
use crate::commands::{Io, EXIT_OK};
use crate::interfaces::git_client::GitClient;
use crate::interfaces::output_formatter::OutputFormatter;
use crate::services::atom_repository::AtomRepository;
use crate::services::path_resolver::PathResolver;
use crate::types::domain::{LoreAtom, SupersessionStatus};
use crate::types::output::{FormattableQueryResult, VisibleTrailers};
use crate::types::query::{QueryResult, ResultTargetType, TargetType};
use crate::util::{LoreError, Result};

pub struct WhyDeps<'a> {
    pub atom_repository: &'a AtomRepository<'a>,
    pub git_client: &'a dyn GitClient,
    pub path_resolver: &'a PathResolver,
    pub formatter: &'a dyn OutputFormatter,
}

pub fn run(args: &WhyArgs, deps: &WhyDeps<'_>, io: &mut Io<'_>) -> Result<i32> {
    let target = deps.path_resolver.parse_target(&args.target);

    if target.target_type != TargetType::LineRange || target.line_start.is_none() {
        return Err(LoreError::new(format!(
            "Target must be file:line or file:line-line format (got \"{}\")",
            args.target
        )));
    }

    let blame_args = deps.path_resolver.to_git_blame_args(&target);
    let blame_lines =
        deps.git_client
            .blame(&blame_args.file, blame_args.line_start, blame_args.line_end)?;

    if blame_lines.is_empty() {
        return Err(LoreError::new(format!(
            "No blame data found for {}",
            args.target
        )));
    }

    // Unique commit hashes in first-seen order.
    let mut seen_hashes: HashSet<&str> = HashSet::new();
    let mut hashes: Vec<&str> = Vec::new();
    for line in &blame_lines {
        if seen_hashes.insert(&line.commit_hash) {
            hashes.push(&line.commit_hash);
        }
    }

    let mut atoms: Vec<LoreAtom> = Vec::new();
    let mut seen_lore_ids: HashSet<String> = HashSet::new();
    for hash in hashes {
        let Some(atom) = deps.atom_repository.find_by_commit_hash(hash)? else {
            continue;
        };
        if seen_lore_ids.insert(atom.lore_id.clone()) {
            atoms.push(atom);
        }
    }

    let meta = build_query_meta(atoms.len(), &atoms);
    let supersession_map: HashMap<String, SupersessionStatus> = atoms
        .iter()
        .map(|a| (a.lore_id.clone(), SupersessionStatus::active()))
        .collect();

    let result = QueryResult {
        command: "why".to_owned(),
        target: args.target.clone(),
        target_type: ResultTargetType::Target(TargetType::LineRange),
        atoms,
        meta,
    };

    let formattable = FormattableQueryResult {
        result,
        supersession_map,
        visible_trailers: VisibleTrailers::All,
    };
    io.print(&deps.formatter.format_query_result(&formattable))?;
    Ok(EXIT_OK)
}
