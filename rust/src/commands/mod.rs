//! Thin command handlers; one module per command. Commands take their
//! dependencies as a struct of references and return the process exit code.

pub mod helpers;

pub mod commit;
pub mod doctor;
pub mod hooks;
pub mod init;
pub mod log;
pub mod path_queries;
pub mod search;
pub mod squash;
pub mod stale;
pub mod trace;
pub mod validate;
pub mod why;
