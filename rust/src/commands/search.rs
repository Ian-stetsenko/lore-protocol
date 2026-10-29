//! `lore search`: cross-cutting query with filters across all atoms.

use crate::cli::SearchArgs;
use crate::commands::helpers::build_query_meta::build_query_meta;
use crate::commands::{Io, EXIT_OK};
use crate::interfaces::output_formatter::OutputFormatter;
use crate::services::atom_repository::{AtomRepository, FindAllOptions};
use crate::services::search_filter::SearchFilter;
use crate::services::supersession_resolver::SupersessionResolver;
use crate::types::output::{FormattableQueryResult, VisibleTrailers};
use crate::types::query::{QueryResult, ResultTargetType, SearchOptions};
use crate::util::Result;

pub struct SearchDeps<'a> {
    pub atom_repository: &'a AtomRepository<'a>,
    pub supersession_resolver: &'a SupersessionResolver,
    pub search_filter: &'a SearchFilter,
    pub formatter: &'a dyn OutputFormatter,
}

pub fn to_search_options(args: &SearchArgs) -> SearchOptions {
    SearchOptions {
        confidence: args.confidence.clone(),
        scope_risk: args.scope_risk.clone(),
        reversibility: args.reversibility.clone(),
        has: args.has.clone(),
        author: args.author.clone(),
        scope: args.scope.clone(),
        text: args.text.clone(),
        since: args.since.clone(),
        until: args.until.clone(),
        limit: args.limit,
        max_commits: args.max_commits,
    }
}

pub fn run(args: &SearchArgs, deps: &SearchDeps<'_>, io: &mut Io<'_>) -> Result<i32> {
    let options = to_search_options(args);

    let atoms = deps.atom_repository.find_all(&FindAllOptions {
        since: options.since.clone(),
        until: options.until.clone(),
        max_commits: options.max_commits,
    })?;

    let atoms = deps.search_filter.apply_filters(&atoms, &options);

    // Supersession on the full filtered set so every atom's status is known.
    let supersession_map = deps.supersession_resolver.resolve(&atoms);
    let total_atoms = atoms.len();

    let mut display_atoms = if args.all {
        atoms
    } else {
        deps.supersession_resolver
            .filter_active(&atoms, &supersession_map)
    };

    if let Some(limit) = options.limit.filter(|l| *l > 0) {
        display_atoms.truncate(limit);
    }

    let meta = build_query_meta(total_atoms, &display_atoms);
    let result = QueryResult {
        command: "search".to_owned(),
        target: build_search_target_description(&options),
        target_type: ResultTargetType::Search,
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

fn present(value: &Option<String>) -> Option<&str> {
    value.as_deref().filter(|v| !v.is_empty())
}

fn build_search_target_description(options: &SearchOptions) -> String {
    let mut parts: Vec<String> = Vec::new();
    let labelled = [
        ("confidence", &options.confidence),
        ("scope-risk", &options.scope_risk),
        ("reversibility", &options.reversibility),
        ("has", &options.has),
        ("author", &options.author),
        ("scope", &options.scope),
    ];
    for (label, value) in labelled {
        if let Some(v) = present(value) {
            parts.push(format!("{label}={v}"));
        }
    }
    if let Some(text) = present(&options.text) {
        parts.push(format!("text=\"{text}\""));
    }
    for (label, value) in [("since", &options.since), ("until", &options.until)] {
        if let Some(v) = present(value) {
            parts.push(format!("{label}={v}"));
        }
    }

    if parts.is_empty() {
        "all".to_owned()
    } else {
        parts.join(", ")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn target_description_lists_active_filters_in_order() {
        let options = SearchOptions {
            confidence: Some("high".into()),
            text: Some("rotate".into()),
            until: Some("2025-01-01".into()),
            ..Default::default()
        };
        assert_eq!(
            build_search_target_description(&options),
            "confidence=high, text=\"rotate\", until=2025-01-01"
        );
        assert_eq!(
            build_search_target_description(&SearchOptions::default()),
            "all"
        );
    }
}
