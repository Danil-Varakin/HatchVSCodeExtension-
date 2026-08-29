import * as vscode from 'vscode';

const PROTOCOL_LINE_LIMIT = 300;

export interface Log {
  info(message: string): void;
  error(message: string): void;
  protocol(direction: '→' | '←', line: string): void;
  stderr(chunk: string): void;
  show(): void;
  dispose(): void;
}

export function createLog(): Log {
  const channel = vscode.window.createOutputChannel('Hatch');
  const stamp = (): string => new Date().toISOString().slice(11, 23);

  return {
    info: (message) => channel.appendLine(`${stamp()} ${message}`),
    error: (message) => channel.appendLine(`${stamp()} ERROR ${message}`),
    protocol: (direction, line) => channel.appendLine(`${stamp()} ${direction} ${clip(line)}`),
    stderr: (chunk) => {
      for (const line of chunk.split('\n')) {
        if (line !== '') channel.appendLine(`${stamp()} [service] ${line}`);
      }
    },
    show: () => channel.show(true),
    dispose: () => channel.dispose(),
  };
}

function clip(line: string): string {
  return line.length <= PROTOCOL_LINE_LIMIT
    ? line
    : `${line.slice(0, PROTOCOL_LINE_LIMIT)}… (${line.length} chars)`;
}
