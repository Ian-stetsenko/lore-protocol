//! `lore trace <lore-id>`: BFS over reference trailers from a starting atom.

use std::collections::{HashSet, VecDeque};

use crate::cli::TraceArgs;
use crate::commands::{Io, EXIT_OK};
use crate::interfaces::output_formatter::OutputFormatter;
use crate::services::atom_repository::AtomRepository;
use crate::types::domain::{LoreAtom, TrailerKey};
use crate::types::output::{FormattableTraceResult, TraceEdge};
use crate::util::constants::is_valid_lore_id;
use crate::util::{LoreError, Result};

pub struct TraceDeps<'a> {
    pub atom_repository: &'a AtomRepository<'a>,
    pub formatter: &'a dyn OutputFormatter,
}

pub fn run(args: &TraceArgs, deps: &TraceDeps<'_>, io: &mut Io<'_>) -> Result<i32> {
    if !is_valid_lore_id(&args.lore_id) {
        return Err(LoreError::new(format!(
            "Invalid Lore-id format: \"{}\". Must be 8-character hex.",
            args.lore_id
        )));
    }

    let Some(root) = deps.atom_repository.find_by_lore_id(&args.lore_id)? else {
        return Err(LoreError::new(format!(
            "Lore-id \"{}\" not found in commit history.",
            args.lore_id
        )));
    };

    let mut edges: Vec<TraceEdge> = Vec::new();
    let mut visited: HashSet<String> = HashSet::new();
    visited.insert(root.lore_id.clone());

    let mut queue: VecDeque<(LoreAtom, usize)> = VecDeque::new();
    queue.push_back((root.clone(), 0));

    // Edges resolve against one shared index (a single `git log --all`)
    // instead of one grep per edge. Built lazily so atoms without
    // references never pay for it.
    let mut index = None;

    while let Some((current, depth)) = queue.pop_front() {
        for key in TrailerKey::REFERENCE {
            let Some(ref_ids) = current.trailers.array_values(key) else {
                continue;
            };
            for ref_id in ref_ids {
                if !is_valid_lore_id(ref_id) {
                    continue;
                }

                let idx = match &index {
                    Some(idx) => idx,
                    None => index.insert(deps.atom_repository.lore_id_index()?),
                };
                let target_atom = idx.get(ref_id).cloned();

                let resolved = target_atom.is_some();
                edges.push(TraceEdge {
                    from: current.lore_id.clone(),
                    to: ref_id.clone(),
                    relationship: key,
                    target_atom: target_atom.clone(),
                });

                if resolved && !visited.contains(ref_id) && depth < args.max_depth {
                    visited.insert(ref_id.clone());
                    if let Some(atom) = target_atom {
                        queue.push_back((atom, depth + 1));
                    }
                }
            }
        }
    }

    let result = FormattableTraceResult { root, edges };
    io.print(&deps.formatter.format_trace_result(&result))?;
    Ok(EXIT_OK)
}

#[cfg(test)]
mod tests;
