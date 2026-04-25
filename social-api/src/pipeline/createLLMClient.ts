// social-api/src/pipeline/createLLMClient.ts
//
// Provider factory. This is the env-var dispatcher that used to live in
// distributed-core; it now lives here so the kernel stays SDK-free.
//
// Usage at startup:
//   const llmClient = createLLMClient();        // reads PIPELINE_LLM_PROVIDER
//   const module = new PipelineModule({ llmClient, ... });

import type { LLMClient } from './LLMClient';
import { AnthropicLLMClient } from './AnthropicLLMClient';
import { BedrockLLMClient } from './BedrockLLMClient';

export type LLMProvider = 'anthropic' | 'bedrock';

export function createLLMClient(provider?: LLMProvider): LLMClient {
  const resolved: LLMProvider =
    provider ??
    (process.env['PIPELINE_LLM_PROVIDER'] as LLMProvider | undefined) ??
    'anthropic';

  switch (resolved) {
    case 'bedrock':
      return new BedrockLLMClient();
    case 'anthropic':
    default:
      return new AnthropicLLMClient();
  }
}
