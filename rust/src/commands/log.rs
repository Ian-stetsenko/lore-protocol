//! `lore log [paths...]`: Lore-enriched git log, newest first, including
//! superseded atoms. Positional paths filter at the git level (#22/#24).

use crate::cli::LogArgs;
use crate::commands::helpers::build_query_meta::build_query_meta;
use crate::commands::{Io, EXIT_OK};
use crate::interfaces::output_formatter::OutputFormatter;
use crate::services::atom_repository::{AtomRepository, FindAllOptions};
use crate::services::supersession_resolver::SupersessionResolver;
use crate::types::output::{FormattableQueryResult, VisibleTrailers};
use crate::types::query::{PathQueryOptions, QueryResult, ResultTargetType};
use crate::util::Result;

pub struct LogDeps<'a> {
    pub atom_repository: &'a AtomRepository<'a>,
    pub supersession_resolver: &'a SupersessionResolver,
    pub formatter: &'a dyn OutputFormatter,
}

pub fn run(args: &LogArgs, deps: &LogDeps<'_>, io: &mut Io<'_>) -> Result<i32> {
    let atoms = if args.paths.is_empty() {
        deps.atom_repository.find_all(&FindAllOptions {
            since: args.since.clone(),
            until: None,
            max_commits: args.max_commits.filter(|m| *m > 0),
        })?
    } else {
        let query_options = PathQueryOptions {
            max_commits: args.max_commits,
            since: args.since.clone(),
            ..PathQueryOptions::default()
        };
        let mut git_args: Vec<String> = vec!["--".to_owned()];
        git_args.extend(args.paths.iter().cloned());
        deps.atom_repository
            .find_by_target(&git_args, &query_options)?
    };

    // Show everything, including superseded atoms.
    let supersession_map = deps.supersession_resolver.resolve(&atoms);
    let total_atoms = atoms.len();

    let mut display_atoms = atoms;
    if let Some(limit) = args.limit.filter(|l| *l > 0) {
        display_atoms.truncate(limit);
    }

    let meta = build_query_meta(total_atoms, &display_atoms);
    let result = QueryResult {
        command: "log".to_owned(),
        target: if args.paths.is_empty() {
            "all".to_owned()
        } else {
            args.paths.join(", ")
        },
        target_type: ResultTargetType::Global,
        atoms: display_atoms,
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

#[cfg(test)]
mod tests;
