//! Business logic. Services are structs with constructor injection; they
//! depend on `interfaces` and `types`, never on `commands` or `formatters`.

pub mod atom_repository;
pub mod commit_builder;
pub mod commit_input_resolver;
pub mod config_loader;
pub mod git_client;
pub mod head_lore_id_reader;
pub mod hook_installer;
pub mod hook_script_generator;
pub mod lore_id_generator;
pub mod path_resolver;
pub mod readers;
pub mod search_filter;
pub mod squash_merger;
pub mod staleness_detector;
pub mod supersession_resolver;
pub mod terminal_prompt;
pub mod trailer_parser;
pub mod validator;
