/**
 * The command ids, in one place. They are also spelled out in `package.json`, and
 * that is one copy too many already: a third and fourth scattered through the code
 * would drift the moment a command is renamed, and a wrong id fails silently as a
 * command that simply does nothing.
 */
export const COMMANDS = {
  generate: 'hatch.generate',
  generateAgainstFile: 'hatch.generateAgainstFile',
  showBase: 'hatch.showBase',
  toggle: 'hatch.toggle',
  goToBaseline: 'hatch.goToBaseline',
  showLog: 'hatch.showLog',
  previewPatch: 'hatch.previewPatch',
  showEditsNotInPatch: 'hatch.showEditsNotInPatch',
  checkAll: 'hatch.checkAll',
  copyReport: 'hatch.copyReport',
  openFailed: 'hatch.openFailed',
  repair: 'hatch.repair',
  initConfig: 'hatch.initConfig',
} as const;

/** The labels offered on notifications, shared by every command that offers them. */
export const ACTIONS = {
  generate: 'Generate Patch',
  generateAgainstFile: 'Pick Old File',
  showLog: 'Show Log',
  showLine: 'Show the Line',
  showInBaseline: 'Show How Far It Got',
  goToEarlier: 'Go to the Earlier Hunk',
  deletePatch: 'Delete Patch…',
  showBase: 'Show Base',
  previewResult: 'Preview Result',
} as const;
