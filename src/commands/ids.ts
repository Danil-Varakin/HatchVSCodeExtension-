/**
 * The command ids, in one place. They are also spelled out in `package.json`, and
 * that is one copy too many already: a third and fourth scattered through the code
 * would drift the moment a command is renamed, and a wrong id fails silently as a
 * command that simply does nothing.
 */
export const COMMANDS = {
  generate: 'hatch.generate',
  pickBaseline: 'hatch.pickBaseline',
  clearBaselineOverride: 'hatch.clearBaselineOverride',
  showBaselineResolution: 'hatch.showBaselineResolution',
  toggle: 'hatch.toggle',
  goToBaseline: 'hatch.goToBaseline',
  showLog: 'hatch.showLog',
} as const;

/** The labels offered on notifications, shared by every command that offers them. */
export const ACTIONS = {
  generate: 'Generate Patch',
  pickBaseline: 'Pick Baseline File',
  showLog: 'Show Log',
  showInBaseline: 'Show How Far It Got',
  goToEarlier: 'Go to the Earlier Hunk',
} as const;
