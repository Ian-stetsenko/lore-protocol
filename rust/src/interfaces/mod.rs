//! Ports: the traits services and commands depend on. Concrete
//! implementations live in `services/` and `formatters/` and are wired only
//! in `main.rs`.

pub mod commit_input_reader;
pub mod config_loader;
pub mod git_client;
pub mod hook_installer;
pub mod lore_id_generator;
pub mod output_formatter;
pub mod prompt;
pub mod trailer_collector;

pub use commit_input_reader::CommitInputReader;
pub use config_loader::ConfigLoader;
pub use git_client::{BlameLine, CommitOptions, CommitResult, GitClient, LogOptions, RawCommit};
pub use hook_installer::{
    HookInstallResult, HookInstaller, HookScriptGenerator, HookUninstallResult,
};
pub use lore_id_generator::LoreIdGenerator;
pub use output_formatter::{ErrorMessage, OutputFormatter};
pub use prompt::{Prompt, TextPromptOptions};
pub use trailer_collector::{CollectedValue, TrailerCollector, TrailerCollectorResult};
