//! Composition root: constructs every concrete implementation and wires the
//! commands together. This is the ONLY place where concrete types are
//! instantiated.

use std::io::{self, IsTerminal, Write};
use std::path::PathBuf;

use clap::error::ErrorKind;
use clap::Parser;

use lore::cli::{Cli, Command};
use lore::commands::helpers::path_query::PathQueryDeps;
use lore::commands::path_queries::PathQueryKind;
use lore::commands::{self, Io};
use lore::formatters::json_formatter::JsonFormatter;
use lore::formatters::text_formatter::TextFormatter;
use lore::interfaces::config_loader::ConfigLoader;
use lore::interfaces::git_client::GitClient;
use lore::interfaces::output_formatter::{ErrorMessage, OutputFormatter};
use lore::services::atom_repository::AtomRepository;
use lore::services::commit_builder::CommitBuilder;
use lore::services::commit_input_resolver::CommitInputResolver;
use lore::services::config_loader::TomlConfigLoader;
use lore::services::git_client::ProcessGitClient;
use lore::services::head_lore_id_reader::HeadLoreIdReader;
use lore::services::hook_installer::FsHookInstaller;
use lore::services::hook_script_generator::BashHookScriptGenerator;
use lore::services::lore_id_generator::RandomLoreIdGenerator;
use lore::services::path_resolver::PathResolver;
use lore::services::search_filter::SearchFilter;
use lore::services::squash_merger::SquashMerger;
use lore::services::staleness_detector::StalenessDetector;
use lore::services::supersession_resolver::SupersessionResolver;
use lore::services::terminal_prompt::TerminalPrompt;
use lore::services::trailer_parser::TrailerParser;
use lore::services::validator::Validator;
use lore::types::config::LoreConfig;
use lore::types::output::Severity;
use lore::util::LoreError;

fn main() {
    let code = run();
    let _ = io::stdout().flush();
    std::process::exit(code);
}

fn run() -> i32 {
    let cli = match Cli::try_parse() {
        Ok(cli) => cli,
        Err(err) => return handle_parse_error(err),
    };

    let mut stdout = io::stdout().lock();
    let mut stderr = io::stderr().lock();
    let mut io_streams = Io::new(&mut stdout, &mut stderr);

    match dispatch(&cli, &mut io_streams) {
        Ok(code) => code,
        // A closed stdout (e.g. `lore log | head`) is not an error.
        Err(LoreError::Io(e)) if e.kind() == io::ErrorKind::BrokenPipe => 0,
        Err(err) => report_error(&cli, &err),
    }
}

/// Commander parity: `--help`/`--version` exit 0 (bare version string);
/// every usage error exits 1.
fn handle_parse_error(err: clap::Error) -> i32 {
    match err.kind() {
        ErrorKind::DisplayVersion => {
            println!("{}", env!("CARGO_PKG_VERSION"));
            0
        }
        ErrorKind::DisplayHelp => {
            let _ = err.print();
            0
        }
        _ => {
            let _ = err.print();
            1
        }
    }
}

fn dispatch(cli: &Cli, io_streams: &mut Io<'_>) -> lore::util::Result<i32> {
    let cwd: PathBuf = std::env::current_dir()?;

    // 1. Concrete implementations
    let git_client = ProcessGitClient::new(None);
    let git_client: &dyn GitClient = &git_client;
    let trailer_parser = TrailerParser::new();
    let path_resolver = PathResolver::new();
    let lore_id_generator = RandomLoreIdGenerator::new();
    let config_loader = TomlConfigLoader::new();
    let config_loader: &dyn ConfigLoader = &config_loader;

    // 2. Configuration (best effort: defaults when missing or unreadable)
    let config: LoreConfig = config_loader
        .load_for_path(&cwd)
        .unwrap_or_else(|_| LoreConfig::default());

    // 3. Services
    let atom_repository =
        AtomRepository::new(git_client, &trailer_parser, config.trailers.custom.clone());
    let supersession_resolver = SupersessionResolver::new();
    let staleness_detector = StalenessDetector::new(git_client, &config);
    let commit_builder = CommitBuilder::new(&trailer_parser, &lore_id_generator, &config);
    let squash_merger = SquashMerger::new(&lore_id_generator);
    let validator = Validator::new(&trailer_parser, &atom_repository, &config);
    let search_filter = SearchFilter::new();
    let prompt = TerminalPrompt::new();
    let commit_input_resolver = CommitInputResolver::new(&prompt);
    let head_lore_id_reader = HeadLoreIdReader::new(git_client, &trailer_parser);
    let hook_script_generator = BashHookScriptGenerator::new();
    let hook_installer = FsHookInstaller::new(&hook_script_generator, &config.hooks);

    // 4. Formatter (clap parses global options up front, so no lazy factory)
    let formatter = make_formatter(cli, io::stdout().is_terminal());
    let formatter: &dyn OutputFormatter = formatter.as_ref();

    // 5. Dispatch
    let path_query_deps = PathQueryDeps {
        atom_repository: &atom_repository,
        supersession_resolver: &supersession_resolver,
        path_resolver: &path_resolver,
        formatter,
        config: &config,
    };

    match &cli.command {
        Command::Init => commands::init::run(
            &commands::init::InitDeps {
                formatter,
                cwd: &cwd,
            },
            io_streams,
        ),
        Command::Context(args) => {
            commands::path_queries::run(PathQueryKind::Context, args, &path_query_deps, io_streams)
        }
        Command::Constraints(args) => commands::path_queries::run(
            PathQueryKind::Constraints,
            args,
            &path_query_deps,
            io_streams,
        ),
        Command::Rejected(args) => {
            commands::path_queries::run(PathQueryKind::Rejected, args, &path_query_deps, io_streams)
        }
        Command::Directives(args) => commands::path_queries::run(
            PathQueryKind::Directives,
            args,
            &path_query_deps,
            io_streams,
        ),
        Command::Tested(args) => {
            commands::path_queries::run(PathQueryKind::Tested, args, &path_query_deps, io_streams)
        }
        Command::Why(args) => commands::why::run(
            args,
            &commands::why::WhyDeps {
                atom_repository: &atom_repository,
                git_client,
                path_resolver: &path_resolver,
                formatter,
            },
            io_streams,
        ),
        Command::Search(args) => commands::search::run(
            args,
            &commands::search::SearchDeps {
                atom_repository: &atom_repository,
                supersession_resolver: &supersession_resolver,
                search_filter: &search_filter,
                formatter,
            },
            io_streams,
        ),
        Command::Log(args) => commands::log::run(
            args,
            &commands::log::LogDeps {
                atom_repository: &atom_repository,
                supersession_resolver: &supersession_resolver,
                formatter,
            },
            io_streams,
        ),
        Command::Stale(args) => commands::stale::run(
            args,
            &commands::stale::StaleDeps {
                atom_repository: &atom_repository,
                supersession_resolver: &supersession_resolver,
                staleness_detector: &staleness_detector,
                path_resolver: &path_resolver,
                formatter,
            },
            io_streams,
        ),
        Command::Trace(args) => commands::trace::run(
            args,
            &commands::trace::TraceDeps {
                atom_repository: &atom_repository,
                formatter,
            },
            io_streams,
        ),
        Command::Commit(args) => commands::commit::run(
            args,
            &commands::commit::CommitDeps {
                commit_builder: &commit_builder,
                git_client,
                formatter,
                commit_input_resolver: &commit_input_resolver,
                head_lore_id_reader: &head_lore_id_reader,
            },
            io_streams,
        ),
        Command::Validate(args) => commands::validate::run(
            args,
            &commands::validate::ValidateDeps {
                validator: &validator,
                git_client,
                trailer_parser: &trailer_parser,
                formatter,
            },
            io_streams,
        ),
        Command::Squash(args) => commands::squash::run(
            args,
            &commands::squash::SquashDeps {
                atom_repository: &atom_repository,
                squash_merger: &squash_merger,
            },
            io_streams,
        ),
        Command::Doctor => commands::doctor::run(
            &commands::doctor::DoctorDeps {
                atom_repository: &atom_repository,
                config_loader,
                formatter,
                cwd: &cwd,
            },
            io_streams,
        ),
        Command::Hooks(args) => commands::hooks::run(
            &args.action,
            &commands::hooks::HooksDeps {
                hook_installer: &hook_installer,
                git_client,
                formatter,
            },
            io_streams,
        ),
    }
}

fn make_formatter(cli: &Cli, stdout_is_tty: bool) -> Box<dyn OutputFormatter> {
    if cli.wants_json() {
        Box::new(JsonFormatter::new())
    } else {
        let color = !cli.no_color && stdout_is_tty && std::env::var_os("NO_COLOR").is_none();
        Box::new(TextFormatter::new(color))
    }
}

/// Render a failure through the formatter implied by the parsed options and
/// return its exit code.
fn report_error(cli: &Cli, err: &LoreError) -> i32 {
    let formatter: Box<dyn OutputFormatter> = if cli.wants_json() {
        Box::new(JsonFormatter::new())
    } else {
        let color =
            !cli.no_color && io::stderr().is_terminal() && std::env::var_os("NO_COLOR").is_none();
        Box::new(TextFormatter::new(color))
    };

    let messages: Vec<ErrorMessage> = match err {
        LoreError::Validation { issues, .. } => issues
            .iter()
            .map(|issue| ErrorMessage {
                severity: issue.severity,
                field: None,
                message: issue.message.clone(),
            })
            .collect(),
        other => vec![ErrorMessage {
            severity: Severity::Error,
            field: None,
            message: other.to_string(),
        }],
    };

    eprintln!("{}", formatter.format_error(err.exit_code(), &messages));
    err.exit_code()
}
