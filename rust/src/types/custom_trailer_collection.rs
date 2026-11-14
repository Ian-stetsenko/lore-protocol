//! Ordered collection of non-Lore (custom) trailers.

use indexmap::IndexMap;
use serde_json::Value;

use super::domain::TrailerKey;

/// Custom trailers keyed by wire name, preserving insertion order.
///
/// Known Lore keys are never stored here; see [`CustomTrailerCollection::from_raw`].
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct CustomTrailerCollection {
    map: IndexMap<String, Vec<String>>,
    line_count: usize,
}

impl CustomTrailerCollection {
    /// Wrap pre-built entries. Empty value lists are kept as given.
    pub fn new(entries: IndexMap<String, Vec<String>>) -> Self {
        let line_count = entries.values().map(Vec::len).sum();
        CustomTrailerCollection {
            map: entries,
            line_count,
        }
    }

    pub fn empty() -> Self {
        CustomTrailerCollection::default()
    }

    /// Extract custom trailers from a raw JSON object.
    ///
    /// Known Lore trailer keys are skipped. A string value is coerced to a
    /// one-element list; a list keeps only its string elements; anything else
    /// (or an empty result) is dropped.
    pub fn from_raw(raw: &serde_json::Map<String, Value>) -> Self {
        let mut entries: IndexMap<String, Vec<String>> = IndexMap::new();
        for (key, value) in raw {
            if TrailerKey::parse(key).is_some() {
                continue;
            }
            if let Some(values) = to_string_vec(value) {
                if !values.is_empty() {
                    entries.insert(key.clone(), values);
                }
            }
        }
        if entries.is_empty() {
            CustomTrailerCollection::empty()
        } else {
            CustomTrailerCollection::new(entries)
        }
    }

    /// Whether `key` is present with at least one value.
    pub fn has(&self, key: &str) -> bool {
        self.map.get(key).map(|v| !v.is_empty()).unwrap_or(false)
    }

    pub fn get(&self, key: &str) -> Option<&[String]> {
        self.map.get(key).map(Vec::as_slice)
    }

    /// Total number of trailer lines across all keys.
    pub fn line_count(&self) -> usize {
        self.line_count
    }

    /// Number of distinct keys.
    pub fn len(&self) -> usize {
        self.map.len()
    }

    pub fn is_empty(&self) -> bool {
        self.map.is_empty()
    }

    pub fn iter(&self) -> impl Iterator<Item = (&String, &Vec<String>)> {
        self.map.iter()
    }

    /// Borrow the underlying ordered map.
    pub fn to_record(&self) -> &IndexMap<String, Vec<String>> {
        &self.map
    }
}

impl<'a> IntoIterator for &'a CustomTrailerCollection {
    type Item = (&'a String, &'a Vec<String>);
    type IntoIter = indexmap::map::Iter<'a, String, Vec<String>>;

    fn into_iter(self) -> Self::IntoIter {
        self.map.iter()
    }
}

impl FromIterator<(String, Vec<String>)> for CustomTrailerCollection {
    fn from_iter<I: IntoIterator<Item = (String, Vec<String>)>>(iter: I) -> Self {
        CustomTrailerCollection::new(iter.into_iter().collect())
    }
}

fn to_string_vec(value: &Value) -> Option<Vec<String>> {
    match value {
        Value::Array(items) => Some(
            items
                .iter()
                .filter_map(|v| v.as_str().map(str::to_owned))
                .collect(),
        ),
        Value::String(s) => Some(vec![s.clone()]),
        _ => None,
    }
}

#[cfg(test)]
mod tests;
