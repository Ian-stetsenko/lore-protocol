//! Creates all trailer collectors in the canonical prompt order.
//!
//! Order: Constraint, Rejected, Confidence, Scope-risk, Reversibility,
//! Directive, Tested, Not-tested, Supersedes, Depends-on, Related.
//! Adding a trailer means appending one collector here.

use crate::interfaces::trailer_collector::TrailerCollector;
use crate::types::domain::TrailerKey;
use crate::util::constants::{
    prompt_strings as p, CONFIDENCE_VALUES, REVERSIBILITY_VALUES, SCOPE_RISK_VALUES,
};

use super::enum_choice_trailer_collector::EnumChoiceTrailerCollector;
use super::multi_value_trailer_collector::MultiValueTrailerCollector;

pub fn create_trailer_collectors() -> Vec<Box<dyn TrailerCollector>> {
    vec![
        Box::new(MultiValueTrailerCollector::new(
            TrailerKey::Constraint,
            p::ADD_CONSTRAINT,
            p::CONSTRAINT_INPUT,
        )),
        Box::new(MultiValueTrailerCollector::new(
            TrailerKey::Rejected,
            p::ADD_REJECTED,
            p::REJECTED_INPUT,
        )),
        Box::new(EnumChoiceTrailerCollector::new(
            TrailerKey::Confidence,
            p::SET_CONFIDENCE,
            p::CONFIDENCE_CHOICE,
            &CONFIDENCE_VALUES,
        )),
        Box::new(EnumChoiceTrailerCollector::new(
            TrailerKey::ScopeRisk,
            p::SET_SCOPE_RISK,
            p::SCOPE_RISK_CHOICE,
            &SCOPE_RISK_VALUES,
        )),
        Box::new(EnumChoiceTrailerCollector::new(
            TrailerKey::Reversibility,
            p::SET_REVERSIBILITY,
            p::REVERSIBILITY_CHOICE,
            &REVERSIBILITY_VALUES,
        )),
        Box::new(MultiValueTrailerCollector::new(
            TrailerKey::Directive,
            p::ADD_DIRECTIVE,
            p::DIRECTIVE_INPUT,
        )),
        Box::new(MultiValueTrailerCollector::new(
            TrailerKey::Tested,
            p::ADD_TESTED,
            p::TESTED_INPUT,
        )),
        Box::new(MultiValueTrailerCollector::new(
            TrailerKey::NotTested,
            p::ADD_NOT_TESTED,
            p::NOT_TESTED_INPUT,
        )),
        Box::new(MultiValueTrailerCollector::new(
            TrailerKey::Supersedes,
            p::ADD_SUPERSEDES,
            p::SUPERSEDES_INPUT,
        )),
        Box::new(MultiValueTrailerCollector::new(
            TrailerKey::DependsOn,
            p::ADD_DEPENDS_ON,
            p::DEPENDS_ON_INPUT,
        )),
        Box::new(MultiValueTrailerCollector::new(
            TrailerKey::Related,
            p::ADD_RELATED,
            p::RELATED_INPUT,
        )),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::{MockPrompt, PromptCall};

    #[test]
    fn creates_eleven_collectors_in_protocol_order() {
        let collectors = create_trailer_collectors();
        assert_eq!(collectors.len(), 11);

        let prompt = MockPrompt::new();
        for c in &collectors {
            c.collect(&prompt).expect("declining never fails");
        }
        assert_eq!(
            prompt.confirm_messages(),
            vec![
                p::ADD_CONSTRAINT,
                p::ADD_REJECTED,
                p::SET_CONFIDENCE,
                p::SET_SCOPE_RISK,
                p::SET_REVERSIBILITY,
                p::ADD_DIRECTIVE,
                p::ADD_TESTED,
                p::ADD_NOT_TESTED,
                p::ADD_SUPERSEDES,
                p::ADD_DEPENDS_ON,
                p::ADD_RELATED,
            ]
        );
        assert!(prompt.calls().iter().all(|c| matches!(
            c,
            PromptCall::Confirm {
                default: Some(false),
                ..
            }
        )));
    }

    #[test]
    fn collectors_report_their_trailer_keys() {
        let prompt = MockPrompt::new();
        let keys: Vec<TrailerKey> = create_trailer_collectors()
            .iter()
            .map(|c| c.collect(&prompt).expect("collect").key)
            .collect();
        assert_eq!(
            keys,
            vec![
                TrailerKey::Constraint,
                TrailerKey::Rejected,
                TrailerKey::Confidence,
                TrailerKey::ScopeRisk,
                TrailerKey::Reversibility,
                TrailerKey::Directive,
                TrailerKey::Tested,
                TrailerKey::NotTested,
                TrailerKey::Supersedes,
                TrailerKey::DependsOn,
                TrailerKey::Related,
            ]
        );
    }
}
