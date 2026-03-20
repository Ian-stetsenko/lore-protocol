export interface IPrompt {
  askText(message: string, options?: { default?: string; maxLength?: number }): Promise<string>;
  askMultiline(message: string): Promise<string>;
  askChoice<T extends string>(message: string, choices: readonly T[]): Promise<T>;
  askConfirm(message: string, defaultValue?: boolean): Promise<boolean>;
  close(): void;
}
