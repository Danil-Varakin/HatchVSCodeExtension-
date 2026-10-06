import type { BaselineDocuments } from './baseline/documents.ts';
import type { PatchIndexCache } from './navigation/patch-index.ts';
import type { PatchResults } from './navigation/results.ts';
import type { Project } from './project/project.ts';
import type { HatchService } from './service/client.ts';
import type { Log } from './ui/log.ts';

/** What the commands work with, made once in `activate`. */
export interface HatchDeps {
  readonly service: HatchService;
  readonly project: Project;
  readonly cache: PatchIndexCache;
  readonly baselines: BaselineDocuments;
  /** base + patch, by the core: the right half of Preview Patch */
  readonly results: PatchResults;
  readonly log: Log;
}
