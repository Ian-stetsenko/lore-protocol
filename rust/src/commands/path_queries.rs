//! `lore context|constraints|rejected|directives|tested <target>`.
//!
//! All five share the pipeline in `helpers::path_query`; they differ only in
//! name and visible trailers. `coverage` is an alias of `tested`.

use crate::cli::PathQueryArgs;
use crate::commands::helpers::path_query::{execute_path_query, PathQueryDeps};
use crate::commands::Io;
use crate::types::domain::TrailerKey;
use crate::types::output::VisibleTrailers;
use crate::util::Result;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PathQueryKind {
    /// Full lore summary showing all trailer types.
    Context,
    /// Only `Constraint` trailers.
    Constraints,
    /// Only `Rejected` trailers.
    Rejected,
    /// Only `Directive` trailers.
    Directives,
    /// `Tested` and `Not-tested` trailers.
    Tested,
}

impl PathQueryKind {
    /// The command name reported in query results.
    pub fn name(self) -> &'static str {
        match self {
            PathQueryKind::Context => "context",
            PathQueryKind::Constraints => "constraints",
            PathQueryKind::Rejected => "rejected",
            PathQueryKind::Directives => "directives",
            PathQueryKind::Tested => "tested",
        }
    }

    pub fn visible_trailers(self) -> VisibleTrailers {
        match self {
            PathQueryKind::Context => VisibleTrailers::All,
            PathQueryKind::Constraints => VisibleTrailers::Only(vec![TrailerKey::Constraint]),
            PathQueryKind::Rejected => VisibleTrailers::Only(vec![TrailerKey::Rejected]),
            PathQueryKind::Directives => VisibleTrailers::Only(vec![TrailerKey::Directive]),
            PathQueryKind::Tested => {
                VisibleTrailers::Only(vec![TrailerKey::Tested, TrailerKey::NotTested])
            }
        }
    }
}

pub fn run(
    kind: PathQueryKind,
    args: &PathQueryArgs,
    deps: &PathQueryDeps<'_>,
    io: &mut Io<'_>,
) -> Result<i32> {
    execute_path_query(args, deps, kind.name(), kind.visible_trailers(), io)
}
