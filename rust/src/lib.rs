//! Lore CLI -- a tool for the Lore protocol: structured decision context
//! (constraints, rejected alternatives, directives, confidence, test notes,
//! cross-references) embedded in git commit messages via trailers.
//!
//! The crate follows the same strict layering as the TypeScript implementation:
//!
//! ```text
//! main.rs        -- composition root (the ONLY place concrete types are wired)
//!   cli          -- clap definitions (argument parsing only, no behaviour)
//!   commands/    -- thin handlers; one module per command
//!     helpers/   -- shared command logic (path-query pipeline, query meta)
//!   formatters/  -- OutputFormatter implementations (text, JSON)
//!   services/    -- business logic (parsing, querying, validation, staleness, ...)
//!   interfaces/  -- traits/ports (GitClient, ConfigLoader, OutputFormatter, Prompt, ...)
//!   types/       -- domain models, config schema, query/output shapes (pure data)
//!   util/        -- constants and error types
//! ```
//!
//! Dependencies flow inward only: commands depend on services and interfaces,
//! services depend on interfaces and types, types and util are leaf modules.

pub mod cli;
pub mod commands;
pub mod formatters;
pub mod interfaces;
pub mod services;
pub mod types;
pub mod util;

#[cfg(test)]
pub mod test_support;
