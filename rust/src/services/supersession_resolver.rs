//! Computes supersession chains and determines which atoms are active.
//!
//! The data it needs (`Supersedes` trailers) lives on the atoms; no git
//! interaction or formatting happens here.

use std::collections::{HashMap, HashSet, VecDeque};

use crate::types::domain::{LoreAtom, LoreId, SupersessionStatus};
use crate::util::constants::is_valid_lore_id;

/// Resolves which atoms have been superseded, following transitive chains.
#[derive(Debug, Clone, Copy, Default)]
pub struct SupersessionResolver;

impl SupersessionResolver {
    pub fn new() -> Self {
        SupersessionResolver
    }

    /// Compute, for every atom in `atoms`, whether it is superseded and by whom.
    ///
    /// Every atom with a `Supersedes` trailer marks the referenced atoms as
    /// superseded by it. Chains are transitive: if A supersedes B and B
    /// supersedes C, both B and C are superseded. References to atoms outside
    /// `atoms` and malformed Lore-ids are ignored. Circular references are
    /// handled safely.
    pub fn resolve(&self, atoms: &[LoreAtom]) -> HashMap<String, SupersessionStatus> {
        let mut status_map: HashMap<String, SupersessionStatus> = atoms
            .iter()
            .map(|atom| (atom.lore_id.clone(), SupersessionStatus::active()))
            .collect();

        let atom_by_id: HashMap<&str, &LoreAtom> = atoms
            .iter()
            .map(|atom| (atom.lore_id.as_str(), atom))
            .collect();

        // First pass: direct supersessions (a later superseder overwrites).
        for atom in atoms {
            for superseded_id in &atom.trailers.supersedes {
                if !is_valid_lore_id(superseded_id) {
                    continue;
                }
                if let Some(status) = status_map.get_mut(superseded_id) {
                    *status = SupersessionStatus::superseded_by(atom.lore_id.clone());
                }
            }
        }

        // Second pass: transitive chains.
        self.resolve_transitive_chains(atoms, &atom_by_id, &mut status_map);

        status_map
    }

    /// Keep only the atoms that are not marked superseded in `supersession_map`.
    /// Atoms absent from the map count as active.
    pub fn filter_active(
        &self,
        atoms: &[LoreAtom],
        supersession_map: &HashMap<String, SupersessionStatus>,
    ) -> Vec<LoreAtom> {
        atoms
            .iter()
            .filter(|atom| {
                !supersession_map
                    .get(&atom.lore_id)
                    .is_some_and(|status| status.superseded)
            })
            .cloned()
            .collect()
    }

    /// For each superseding atom, walk what its superseded atoms themselves
    /// supersede, marking everything along the way. Atoms already marked keep
    /// their first superseder. A visited set guards against cycles.
    fn resolve_transitive_chains(
        &self,
        atoms: &[LoreAtom],
        atom_by_id: &HashMap<&str, &LoreAtom>,
        status_map: &mut HashMap<String, SupersessionStatus>,
    ) {
        for atom in atoms {
            if atom.trailers.supersedes.is_empty() {
                continue;
            }

            let mut visited: HashSet<&str> = HashSet::new();
            visited.insert(atom.lore_id.as_str());

            let mut queue: VecDeque<&LoreId> = atom.trailers.supersedes.iter().collect();

            while let Some(current_id) = queue.pop_front() {
                if !visited.insert(current_id.as_str()) {
                    continue;
                }

                if !is_valid_lore_id(current_id) {
                    continue;
                }

                if let Some(status) = status_map.get_mut(current_id) {
                    if !status.superseded {
                        *status = SupersessionStatus::superseded_by(atom.lore_id.clone());
                    }
                }

                if let Some(superseded_atom) = atom_by_id.get(current_id.as_str()) {
                    for next_id in &superseded_atom.trailers.supersedes {
                        if !visited.contains(next_id.as_str()) {
                            queue.push_back(next_id);
                        }
                    }
                }
            }
        }
    }
}

#[cfg(test)]
mod tests;
