// Local mirror of the LLMClient contract exported from distributed-core.
// Phase 4 note: when distributed-core is published as an npm package or
// wired as a workspace dep, replace this file with:
//   export type { LLMClient, LLMChunk, LLMStreamOptions } from 'distributed-core';
// For now, mirror the shape here to avoid cross-repo path dependencies.
// Must stay byte-identical (modulo comments) to the distributed-core copy.

export interface LLMStreamOptions {
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
}

export type LLMChunk =
  | { done: false; token: string }
  | { done: true; response: string; tokensIn: number; tokensOut: number };

export interface LLMClient {
  stream(
    model: string,
    systemPrompt: string,
    userPrompt: string,
    opts?: LLMStreamOptions,
  ): AsyncIterable<LLMChunk>;
}
