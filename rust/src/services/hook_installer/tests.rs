use std::fs;
use std::path::{Path, PathBuf};

use tempfile::TempDir;

use super::*;
use crate::services::hook_script_generator::{BashHookScriptGenerator, LORE_MARKER};

struct Fixture {
    root: TempDir,
    generator: BashHookScriptGenerator,
    config: HooksConfig,
}

impl Fixture {
    fn new() -> Self {
        Fixture {
            root: tempfile::tempdir().expect("temp dir"),
            generator: BashHookScriptGenerator::new(),
            config: HooksConfig::default(),
        }
    }

    fn installer(&self) -> FsHookInstaller<'_> {
        FsHookInstaller::new(&self.generator, &self.config)
    }

    fn repo_root(&self) -> &Path {
        self.root.path()
    }

    fn hooks_dir(&self) -> PathBuf {
        self.repo_root().join(".git").join("hooks")
    }

    fn hook_path(&self) -> PathBuf {
        self.hooks_dir().join("commit-msg")
    }

    fn write_existing_hook(&self, content: &str) {
        fs::create_dir_all(self.hooks_dir()).unwrap();
        fs::write(self.hook_path(), content).unwrap();
    }

    fn hook_content(&self) -> String {
        fs::read_to_string(self.hook_path()).unwrap()
    }
}

#[cfg(unix)]
fn assert_executable(path: &Path) {
    use std::os::unix::fs::PermissionsExt;
    let mode = fs::metadata(path).unwrap().permissions().mode();
    assert_eq!(mode & 0o777, 0o755);
}

#[cfg(not(unix))]
fn assert_executable(path: &Path) {
    // Windows has no executable bit; the hook only needs to exist.
    assert!(path.is_file());
}

mod install {
    use super::*;

    #[test]
    fn installs_hook_when_no_existing_hook_exists() {
        let f = Fixture::new();

        let result = f.installer().install(f.repo_root(), false).unwrap();

        assert!(result.installed);
        assert_eq!(result.hook_path, f.hook_path());
        assert!(!result.already_installed);
        assert_eq!(result.backed_up, None);
        assert!(f.hooks_dir().is_dir());
        assert!(f.hook_content().contains(LORE_MARKER));
        assert_executable(&f.hook_path());
    }

    #[test]
    fn overwrites_existing_lore_managed_hook_silently() {
        let f = Fixture::new();
        f.write_existing_hook(&format!("#!/bin/bash\n{LORE_MARKER}\nold content"));

        let result = f.installer().install(f.repo_root(), false).unwrap();

        assert!(result.installed);
        assert!(result.already_installed);
        assert_eq!(result.backed_up, None);
        assert!(!f.hooks_dir().join("commit-msg.bak").exists());
        assert!(!f.hook_content().contains("old content"));
    }

    #[test]
    fn refuses_to_overwrite_non_lore_hook_without_force() {
        let f = Fixture::new();
        f.write_existing_hook("#!/bin/bash\nsome other hook");

        let result = f.installer().install(f.repo_root(), false).unwrap();

        assert!(!result.installed);
        assert!(!result.already_installed);
        assert_eq!(result.hook_path, f.hook_path());
        assert_eq!(f.hook_content(), "#!/bin/bash\nsome other hook");
    }

    #[test]
    fn backs_up_non_lore_hook_and_installs_with_force() {
        let f = Fixture::new();
        f.write_existing_hook("#!/bin/bash\nsome other hook");

        let result = f.installer().install(f.repo_root(), true).unwrap();

        let backup = f.hooks_dir().join("commit-msg.bak");
        assert!(result.installed);
        assert!(!result.already_installed);
        assert_eq!(result.backed_up, Some(backup.clone()));
        assert_eq!(
            fs::read_to_string(&backup).unwrap(),
            "#!/bin/bash\nsome other hook"
        );
        assert!(f.hook_content().contains(LORE_MARKER));
    }

    #[test]
    fn creates_git_hooks_directory_if_missing() {
        let f = Fixture::new();
        assert!(!f.hooks_dir().exists());

        f.installer().install(f.repo_root(), false).unwrap();

        assert!(f.hooks_dir().is_dir());
    }

    #[test]
    fn sets_executable_permission_on_hook_file() {
        let f = Fixture::new();

        f.installer().install(f.repo_root(), false).unwrap();

        assert_executable(&f.hook_path());
    }
}

mod uninstall {
    use super::*;

    #[test]
    fn removes_lore_managed_hook() {
        let f = Fixture::new();
        f.write_existing_hook(&format!("#!/bin/bash\n{LORE_MARKER}\ncontent"));

        let result = f.installer().uninstall(f.repo_root()).unwrap();

        assert!(result.removed);
        assert!(!result.not_lore_hook);
        assert_eq!(result.hook_path, f.hook_path());
        assert!(!f.hook_path().exists());
    }

    #[test]
    fn refuses_to_remove_non_lore_hook() {
        let f = Fixture::new();
        f.write_existing_hook("#!/bin/bash\nsome other hook");

        let result = f.installer().uninstall(f.repo_root()).unwrap();

        assert!(!result.removed);
        assert!(result.not_lore_hook);
        assert!(f.hook_path().exists());
    }

    #[test]
    fn handles_missing_hook_gracefully() {
        let f = Fixture::new();

        let result = f.installer().uninstall(f.repo_root()).unwrap();

        assert!(!result.removed);
        assert!(!result.not_lore_hook);
        assert_eq!(result.hook_path, f.hook_path());
    }
}
