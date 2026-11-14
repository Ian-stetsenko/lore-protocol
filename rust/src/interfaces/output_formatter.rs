//! Port for rendering results (Strategy: text vs JSON).

use crate::types::output::{
    FormattableDoctorResult, FormattableQueryResult, FormattableStalenessResult,
    FormattableTraceResult, FormattableValidationResult, Severity,
};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ErrorMessage {
    pub severity: Severity,
    pub field: Option<String>,
    pub message: String,
}

impl ErrorMessage {
    pub fn error(message: impl Into<String>) -> Self {
        ErrorMessage {
            severity: Severity::Error,
            field: None,
            message: message.into(),
        }
    }

    pub fn warning(message: impl Into<String>) -> Self {
        ErrorMessage {
            severity: Severity::Warning,
            field: None,
            message: message.into(),
        }
    }
}

pub trait OutputFormatter {
    fn format_query_result(&self, data: &FormattableQueryResult) -> String;
    fn format_validation_result(&self, data: &FormattableValidationResult) -> String;
    fn format_staleness_result(&self, data: &FormattableStalenessResult) -> String;
    fn format_trace_result(&self, data: &FormattableTraceResult) -> String;
    fn format_doctor_result(&self, data: &FormattableDoctorResult) -> String;
    /// `data` is merged into the JSON object; the text formatter ignores it.
    fn format_success(
        &self,
        message: &str,
        data: Option<&serde_json::Map<String, serde_json::Value>>,
    ) -> String;
    fn format_error(&self, code: i32, messages: &[ErrorMessage]) -> String;
}
