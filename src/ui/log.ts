import * as vscode from 'vscode';

// A LogOutputChannel: the editor stamps each line and filters by level ("Developer: Set
// Log Level"). Protocol frames carry the text of files and patches, so they go out on
// `trace` only — off unless someone turns it on — and never on the default level.

export interface Log {
  info(message: string): void;
  warn(message: string): void;
  error(message: string): void;
  /** quiet detail: off by default */
  debug(message: string): void;
  protocol(direction: '→' | '←', line: string): void;
  stderr(chunk: string): void;
  show(): void;
  dispose(): void;
}

export function createLog(): Log {
  const channel = vscode.window.createOutputChannel('Hatch', { log: true });

  return {
    info: (message) => channel.info(message),
    warn: (message) => channel.warn(message),
    error: (message) => channel.error(message),
    debug: (message) => channel.debug(message),
    protocol: (direction, line) => channel.trace(`${direction} ${line}`),
    stderr: (chunk) => {
      for (const line of chunk.split('\n')) {
        if (line !== '') channel.info(`[service] ${line}`);
      }
    },
    show: () => channel.show(true),
    dispose: () => channel.dispose(),
  };
}
