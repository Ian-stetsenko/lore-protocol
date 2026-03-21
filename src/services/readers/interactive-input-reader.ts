import type { ICommitInputReader } from '../../interfaces/commit-input-reader.js';
import type { CommitInput } from '../commit-builder.js';
import type { IPrompt } from '../../interfaces/prompt.js';
import type { ConfidenceLevel, ScopeRiskLevel, ReversibilityLevel } from '../../types/domain.js';
import {
  CONFIDENCE_VALUES,
  SCOPE_RISK_VALUES,
  REVERSIBILITY_VALUES,
  PROMPT_STRINGS,
} from '../../util/constants.js';

/**
 * Reads commit input through interactive terminal prompts.
 *
 * Template Method pattern (via composition): read() orchestrates the
 * collection steps -- collectIntent(), collectBody(), collectTrailers() --
 * each of which is a private method responsible for one section.
 *
 * GRASP: Information Expert -- owns all knowledge of interactive input collection.
 * SOLID: SRP -- single responsibility of collecting commit input interactively.
 */
export class InteractiveInputReader implements ICommitInputReader {
  constructor(private readonly prompt: IPrompt) {}

  async read(): Promise<CommitInput> {
    try {
      const intent = await this.collectIntent();
      const body = await this.collectBody();
      const trailers = await this.collectTrailers();
      return { intent, body, trailers };
    } finally {
      this.prompt.close();
    }
  }

  private async collectIntent(): Promise<string> {
    return this.prompt.askText(PROMPT_STRINGS.INTENT, {
      maxLength: 72,
    });
  }

  private async collectBody(): Promise<string | undefined> {
    const wantsBody = await this.prompt.askConfirm(PROMPT_STRINGS.ADD_BODY, false);
    if (!wantsBody) {
      return undefined;
    }
    return this.prompt.askMultiline(PROMPT_STRINGS.BODY_INPUT);
  }

  private async collectTrailers(): Promise<CommitInput['trailers']> {
    // Constraints
    const constraints = await this.collectMultipleValues(
      PROMPT_STRINGS.ADD_CONSTRAINT,
      PROMPT_STRINGS.CONSTRAINT_INPUT,
    );

    // Rejected
    const rejected = await this.collectMultipleValues(
      PROMPT_STRINGS.ADD_REJECTED,
      PROMPT_STRINGS.REJECTED_INPUT,
    );

    // Confidence
    let confidence: ConfidenceLevel | undefined;
    const wantsConfidence = await this.prompt.askConfirm(PROMPT_STRINGS.SET_CONFIDENCE, false);
    if (wantsConfidence) {
      confidence = await this.prompt.askChoice(PROMPT_STRINGS.CONFIDENCE_CHOICE, CONFIDENCE_VALUES);
    }

    // Scope-risk
    let scopeRisk: ScopeRiskLevel | undefined;
    const wantsScopeRisk = await this.prompt.askConfirm(PROMPT_STRINGS.SET_SCOPE_RISK, false);
    if (wantsScopeRisk) {
      scopeRisk = await this.prompt.askChoice(PROMPT_STRINGS.SCOPE_RISK_CHOICE, SCOPE_RISK_VALUES);
    }

    // Reversibility
    let reversibility: ReversibilityLevel | undefined;
    const wantsReversibility = await this.prompt.askConfirm(PROMPT_STRINGS.SET_REVERSIBILITY, false);
    if (wantsReversibility) {
      reversibility = await this.prompt.askChoice(PROMPT_STRINGS.REVERSIBILITY_CHOICE, REVERSIBILITY_VALUES);
    }

    // Directives
    const directives = await this.collectMultipleValues(
      PROMPT_STRINGS.ADD_DIRECTIVE,
      PROMPT_STRINGS.DIRECTIVE_INPUT,
    );

    // Tested
    const tested = await this.collectMultipleValues(
      PROMPT_STRINGS.ADD_TESTED,
      PROMPT_STRINGS.TESTED_INPUT,
    );

    // Not-tested
    const notTested = await this.collectMultipleValues(
      PROMPT_STRINGS.ADD_NOT_TESTED,
      PROMPT_STRINGS.NOT_TESTED_INPUT,
    );

    // Supersedes
    const supersedes = await this.collectMultipleValues(
      PROMPT_STRINGS.ADD_SUPERSEDES,
      PROMPT_STRINGS.SUPERSEDES_INPUT,
    );

    // Depends-on
    const dependsOn = await this.collectMultipleValues(
      PROMPT_STRINGS.ADD_DEPENDS_ON,
      PROMPT_STRINGS.DEPENDS_ON_INPUT,
    );

    // Related
    const related = await this.collectMultipleValues(
      PROMPT_STRINGS.ADD_RELATED,
      PROMPT_STRINGS.RELATED_INPUT,
    );

    return {
      Constraint: constraints.length > 0 ? constraints : undefined,
      Rejected: rejected.length > 0 ? rejected : undefined,
      Confidence: confidence,
      'Scope-risk': scopeRisk,
      Reversibility: reversibility,
      Directive: directives.length > 0 ? directives : undefined,
      Tested: tested.length > 0 ? tested : undefined,
      'Not-tested': notTested.length > 0 ? notTested : undefined,
      Supersedes: supersedes.length > 0 ? supersedes : undefined,
      'Depends-on': dependsOn.length > 0 ? dependsOn : undefined,
      Related: related.length > 0 ? related : undefined,
    };
  }

  /**
   * Collect multiple values of the same trailer type.
   * Asks the user if they want to add one; if yes, collects value and asks again.
   */
  private async collectMultipleValues(
    confirmMessage: string,
    inputMessage: string,
  ): Promise<string[]> {
    const values: string[] = [];

    while (true) {
      const wantsMore = await this.prompt.askConfirm(confirmMessage, false);
      if (!wantsMore) break;

      const value = await this.prompt.askText(inputMessage);
      if (value.trim()) {
        values.push(value.trim());
      }
    }

    return values;
  }
}
