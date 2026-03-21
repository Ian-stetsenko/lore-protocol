import type { ITrailerCollector } from '../../../interfaces/trailer-collector.js';
import { MultiValueTrailerCollector } from './multi-value-trailer-collector.js';
import { EnumChoiceTrailerCollector } from './enum-choice-trailer-collector.js';
import {
  CONFIDENCE_VALUES,
  SCOPE_RISK_VALUES,
  REVERSIBILITY_VALUES,
  PROMPT_STRINGS,
} from '../../../util/constants.js';

/**
 * Creates all trailer collectors in the correct prompt order.
 *
 * Order: Constraint, Rejected, Confidence, Scope-risk, Reversibility,
 * Directive, Tested, Not-tested, Supersedes, Depends-on, Related.
 *
 * GRASP: Creator -- centralizes collector instantiation with configuration knowledge.
 * SOLID: OCP -- adding a new trailer requires only appending a collector here.
 */
export function createTrailerCollectors(): readonly ITrailerCollector[] {
  return [
    new MultiValueTrailerCollector({
      key: 'Constraint',
      confirmMessage: PROMPT_STRINGS.ADD_CONSTRAINT,
      inputMessage: PROMPT_STRINGS.CONSTRAINT_INPUT,
    }),
    new MultiValueTrailerCollector({
      key: 'Rejected',
      confirmMessage: PROMPT_STRINGS.ADD_REJECTED,
      inputMessage: PROMPT_STRINGS.REJECTED_INPUT,
    }),
    new EnumChoiceTrailerCollector({
      key: 'Confidence',
      confirmMessage: PROMPT_STRINGS.SET_CONFIDENCE,
      choiceMessage: PROMPT_STRINGS.CONFIDENCE_CHOICE,
      values: CONFIDENCE_VALUES,
    }),
    new EnumChoiceTrailerCollector({
      key: 'Scope-risk',
      confirmMessage: PROMPT_STRINGS.SET_SCOPE_RISK,
      choiceMessage: PROMPT_STRINGS.SCOPE_RISK_CHOICE,
      values: SCOPE_RISK_VALUES,
    }),
    new EnumChoiceTrailerCollector({
      key: 'Reversibility',
      confirmMessage: PROMPT_STRINGS.SET_REVERSIBILITY,
      choiceMessage: PROMPT_STRINGS.REVERSIBILITY_CHOICE,
      values: REVERSIBILITY_VALUES,
    }),
    new MultiValueTrailerCollector({
      key: 'Directive',
      confirmMessage: PROMPT_STRINGS.ADD_DIRECTIVE,
      inputMessage: PROMPT_STRINGS.DIRECTIVE_INPUT,
    }),
    new MultiValueTrailerCollector({
      key: 'Tested',
      confirmMessage: PROMPT_STRINGS.ADD_TESTED,
      inputMessage: PROMPT_STRINGS.TESTED_INPUT,
    }),
    new MultiValueTrailerCollector({
      key: 'Not-tested',
      confirmMessage: PROMPT_STRINGS.ADD_NOT_TESTED,
      inputMessage: PROMPT_STRINGS.NOT_TESTED_INPUT,
    }),
    new MultiValueTrailerCollector({
      key: 'Supersedes',
      confirmMessage: PROMPT_STRINGS.ADD_SUPERSEDES,
      inputMessage: PROMPT_STRINGS.SUPERSEDES_INPUT,
    }),
    new MultiValueTrailerCollector({
      key: 'Depends-on',
      confirmMessage: PROMPT_STRINGS.ADD_DEPENDS_ON,
      inputMessage: PROMPT_STRINGS.DEPENDS_ON_INPUT,
    }),
    new MultiValueTrailerCollector({
      key: 'Related',
      confirmMessage: PROMPT_STRINGS.ADD_RELATED,
      inputMessage: PROMPT_STRINGS.RELATED_INPUT,
    }),
  ];
}
