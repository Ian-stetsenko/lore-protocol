//! Pure data shapes: domain models, configuration schema, query and output types.
//! No logic beyond trivial accessors lives here.

pub mod commit_input;
pub mod config;
pub mod custom_trailer_collection;
pub mod domain;
pub mod output;
pub mod query;

pub use commit_input::{CommitCommandOptions, CommitInput, CommitInputTrailers};
pub use config::{
    CliConfig, FollowConfig, HooksConfig, LoreConfig, OutputConfig, OutputFormat, ProtocolConfig,
    StaleConfig, TrailersConfig, ValidationConfig,
};
pub use custom_trailer_collection::CustomTrailerCollection;
pub use domain::{
    ConfidenceLevel, LoreAtom, LoreId, LoreTrailers, ReversibilityLevel, ScopeRiskLevel,
    SupersessionStatus, TrailerKey,
};
pub use output::{
    CommitValidationResult, DoctorCheck, DoctorStatus, DoctorSummary, FormattableDoctorResult,
    FormattableQueryResult, FormattableStalenessResult, FormattableTraceResult,
    FormattableValidationResult, Severity, StaleAtomReport, StaleReason, StaleSignal, TraceEdge,
    ValidationIssue, ValidationSummary, VisibleTrailers,
};
pub use query::{
    PathQueryOptions, QueryMeta, QueryResult, QueryTarget, ResultTargetType, SearchOptions,
    TargetType,
};
