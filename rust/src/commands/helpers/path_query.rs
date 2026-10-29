//! Shared pipeline for the path-scoped query commands (`context`,
//! `constraints`, `rejected`, `directives`, `tested`).
//!
//! Each command follows the same resolve -> query -> follow -> supersession ->
//! limit -> format pipeline, differing only in which trailers are visible
//! (Template Method via composition).

use crate::cli::PathQueryArgs;
use crate::commands::helpers::build_query_meta::build_query_meta;
use crate::commands::{Io, EXIT_OK};
use crate::interfaces::output_formatter::OutputFormatter;
use crate::services::atom_repository::AtomRepository;
use crate::services::path_resolver::PathResolver;
use crate::services::supersession_resolver::SupersessionResolver;
use crate::types::config::LoreConfig;
use crate::types::output::{FormattableQueryResult, VisibleTrailers};
use crate::types::query::{PathQueryOptions, QueryResult, ResultTargetType};
use crate::util::Result;

pub struct PathQueryDeps<'a> {
    pub atom_repository: &'a AtomRepository<'a>,
    pub supersession_resolver: &'a SupersessionResolver,
    pub path_resolver: &'a PathResolver,
    pub formatter: &'a dyn OutputFormatter,
    pub config: &'a LoreConfig,
}

/// Map CLI flags onto the repository's query options.
pub fn to_query_options(args: &PathQueryArgs) -> PathQueryOptions {
    PathQueryOptions {
        scope: args.scope.clone(),
        follow: args.follow,
        all: args.all,
        author: args.author.clone(),
        limit: args.limit,
        max_commits: args.max_commits,
        since: args.since.clone(),
    }
}

pub fn execute_path_query(
    args: &PathQueryArgs,
    deps: &PathQueryDeps<'_>,
    command_name: &str,
    visible_trailers: VisibleTrailers,
    io: &mut Io<'_>,
) -> Result<i32> {
    let options = to_query_options(args);

    // Step 1: resolve the target or use --scope
    let (mut atoms, target_type, target_display) = match &options.scope {
        Some(scope) => (
            deps.atom_repository.find_by_scope(scope, &options)?,
            ResultTargetType::Global,
            format!("scope:{scope}"),
        ),
        None => {
            let parsed = deps.path_resolver.parse_target(&args.target);
            let git_log_args = deps.path_resolver.to_git_log_args(&parsed);
            (
                deps.atom_repository
                    .find_by_target(&git_log_args, &options)?,
                ResultTargetType::Target(parsed.target_type),
                args.target.clone(),
            )
        }
    };

    // Step 2: follow links if requested
    if options.follow && !atoms.is_empty() {
        atoms = deps
            .atom_repository
            .resolve_follow_links(&atoms, deps.config.follow.max_depth)?;
    }

    let total_atoms = atoms.len();

    // Step 3: compute supersession
    let supersession_map = deps.supersession_resolver.resolve(&atoms);

    // Step 4: hide superseded atoms unless --all
    let mut display_atoms = if options.all {
        atoms
    } else {
        deps.supersession_resolver
            .filter_active(&atoms, &supersession_map)
    };

    // Step 4b: result limit after supersession filtering
    if let Some(limit) = options.limit.filter(|l| *l > 0) {
        display_atoms.truncate(limit);
    }

    // Step 5: build the result
    let meta = build_query_meta(total_atoms, &display_atoms);
    let result = QueryResult {
        command: command_name.to_owned(),
        target: target_display,
        target_type,
        atoms: display_atoms,
        meta,
    };

    // Step 6: format and print
    let formattable = FormattableQueryResult {
        result,
        supersession_map,
        visible_trailers,
    };
    io.print(&deps.formatter.format_query_result(&formattable))?;
    Ok(EXIT_OK)
}

#[cfg(test)]
mod tests;
