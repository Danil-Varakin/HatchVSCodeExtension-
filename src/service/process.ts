import { spawn } from 'node:child_process';
import type { ChildProcessWithoutNullStreams } from 'node:child_process';
import { existsSync } from 'node:fs';
import type { Log } from '../ui/log.ts';
import { ServiceMissingError } from '../errors.ts';

export interface ServiceProcessEvents {
  /** One complete newline-terminated frame from the service's stdout. */
  readonly onLine: (line: string) => void;
  /** The child went away on its own. Not fired for a stop() we asked for. */
  readonly onGone: (reason: string) => void;
}

/**
 * Owns the child process and the newline framing of its stdout. Knows nothing
 * about requests, ids or responses: that is the client's half of the job.
 */
export class ServiceProcess {
  private readonly servicePath: string;
  private readonly grammarDir: string | undefined;
  private readonly log: Log;
  private readonly events: ServiceProcessEvents;
  private child: ChildProcessWithoutNullStreams | null = null;
  /** how many times a core was started: the end-to-end tests read it */
  spawns = 0;

  constructor(
    servicePath: string,
    grammarDir: string | undefined,
    log: Log,
    events: ServiceProcessEvents,
  ) {
    this.servicePath = servicePath;
    this.grammarDir = grammarDir;
    this.log = log;
    this.events = events;
  }

  /** Spawns the service if it is not already up. Throws before touching any state. */
  start(): void {
    if (this.child !== null) return;

    if (!existsSync(this.servicePath)) throw new ServiceMissingError(this.servicePath);

    this.log.info(`spawning service: ${this.servicePath}`);
    this.spawns += 1;
    const child = spawn(process.execPath, [this.servicePath], {
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        ...(this.grammarDir !== undefined ? { HATCH_GRAMMAR_DIR: this.grammarDir } : {}),
      },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    // A child we stopped can still have output in the pipe. It is its own, never the next
    // child's: half a frame of it in a shared buffer would corrupt the first reply of the
    // new process, and that request would wait forever.
    const frames = new LineFramer((line) => {
      if (this.child === child) this.events.onLine(line);
    });
    child.stdout.on('data', (chunk: string) => frames.push(chunk));
    child.stderr.on('data', (chunk: string) => this.log.stderr(chunk));
    // writing into a pipe whose far end is gone must not reach the extension host
    child.stdin.on('error', (e: Error) => this.log.error(`service stdin: ${e.message}`));
    child.on('error', (e) => this.forget(child, `service failed to spawn: ${e.message}`));
    child.on('exit', (code, signal) =>
      this.forget(child, `service exited (code ${code ?? 'none'}, signal ${signal ?? 'none'})`),
    );

    this.child = child;
  }

  send(line: string): void {
    const child = this.child;
    if (child === null) throw new Error('hatch service is not running');
    this.log.protocol('→', line);
    child.stdin.write(`${line}\n`);
  }

  /** Kills the child on purpose. onGone is not fired: the caller already knows. */
  stop(): void {
    const child = this.child;
    this.child = null;
    child?.kill();
  }

  private forget(child: ChildProcessWithoutNullStreams, reason: string): void {
    if (this.child !== child) return;
    this.child = null;
    this.events.onGone(reason);
  }
}

/** Newline framing of one stream: whole non-blank lines out, the unfinished tail kept. */
export class LineFramer {
  private buffer = '';
  private readonly onLine: (line: string) => void;

  constructor(onLine: (line: string) => void) {
    this.onLine = onLine;
  }

  push(chunk: string): void {
    this.buffer += chunk;
    let cut = this.buffer.indexOf('\n');
    while (cut !== -1) {
      const line = this.buffer.slice(0, cut);
      this.buffer = this.buffer.slice(cut + 1);
      if (line.trim() !== '') this.onLine(line);
      cut = this.buffer.indexOf('\n');
    }
  }
}
