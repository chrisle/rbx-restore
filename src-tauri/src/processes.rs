//! The programs that must not be running while the library is replaced.
use sysinfo::{ProcessRefreshKind, RefreshKind, System};

#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub struct Running {
    /// rekordbox or its agent, either of which may write the library.
    pub rekordbox: bool,
    /// RBXport, which keeps the library open and caches what it read.
    pub rbxport: bool,
}

fn classify(name: &str, running: &mut Running) {
    let name = name.to_ascii_lowercase();
    let name = name.strip_suffix(".exe").unwrap_or(&name);
    match name {
        // The app and its agent, not their Electron helpers.
        "rekordbox" | "rekordboxagent" => running.rekordbox = true,
        "rbxport" => running.rbxport = true,
        _ => {}
    }
}

pub fn running() -> Running {
    let system = System::new_with_specifics(RefreshKind::new().with_processes(ProcessRefreshKind::new()));
    let mut running = Running::default();
    for process in system.processes().values() {
        classify(&process.name().to_string_lossy(), &mut running);
    }
    running
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn matches_the_apps_but_not_their_helpers_or_this_app() {
        let mut found = Running::default();
        for name in ["rekordbox Helper", "rbxport-restore", "RBXport Restore", "Finder"] {
            classify(name, &mut found);
        }
        assert_eq!(found, Running::default());
        classify("rekordboxAgent.exe", &mut found);
        assert_eq!(found, Running { rekordbox: true, rbxport: false });
        classify("RBXPORT.EXE", &mut found);
        assert_eq!(found, Running { rekordbox: true, rbxport: true });
    }
}
