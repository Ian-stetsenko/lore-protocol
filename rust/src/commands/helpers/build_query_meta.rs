//! Build [`QueryMeta`] from a set of atoms.

use crate::types::domain::LoreAtom;
use crate::types::query::QueryMeta;

/// `total_atoms` is the count before any result-level limiting (`--limit`);
/// `display_atoms` are the atoms actually shown.
pub fn build_query_meta(total_atoms: usize, display_atoms: &[LoreAtom]) -> QueryMeta {
    let oldest = display_atoms.iter().map(|a| a.date).min();
    let newest = display_atoms.iter().map(|a| a.date).max();
    QueryMeta {
        total_atoms,
        filtered_atoms: display_atoms.len(),
        oldest,
        newest,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::{atom, date};

    #[test]
    fn empty_display_set_has_no_dates() {
        let meta = build_query_meta(7, &[]);
        assert_eq!(meta.total_atoms, 7);
        assert_eq!(meta.filtered_atoms, 0);
        assert!(meta.oldest.is_none() && meta.newest.is_none());
    }

    #[test]
    fn picks_oldest_and_newest_from_displayed_atoms() {
        let atoms = vec![
            atom().id("aaaa1111").date("2025-03-01T00:00:00Z").build(),
            atom().id("bbbb2222").date("2024-01-01T00:00:00Z").build(),
            atom().id("cccc3333").date("2025-06-15T12:00:00Z").build(),
        ];
        let meta = build_query_meta(10, &atoms);
        assert_eq!(meta.total_atoms, 10);
        assert_eq!(meta.filtered_atoms, 3);
        assert_eq!(meta.oldest, Some(date("2024-01-01T00:00:00Z")));
        assert_eq!(meta.newest, Some(date("2025-06-15T12:00:00Z")));
    }
}
