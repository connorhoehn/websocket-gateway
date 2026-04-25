// frontend/src/components/pipelines/nodes/docsContent.tsx
//
// Inline help copy shown in the ConfigPanel "Docs" tab for each of the 8 node
// types. Content is derived from PIPELINES_PLAN.md §5 (node spec) and §18.10
// (UI/help). Pithy, direct; intended as in-product reference — not prose docs.
//
// Shape: a flat Record<NodeType, ReactNode>. The ConfigPanel applies its own
// prose styling (font size, line-height, <h4> border) via inline styles on
// the container, so the JSX here is semantic-only.

import type { ReactNode } from 'react';
import type { NodeType } from '../../../types/pipeline';

const docsContent: Record<NodeType, ReactNode> = {
  // -------------------------------------------------------------------------
  // Trigger
  // -------------------------------------------------------------------------
  trigger: (
    <>
      <h4>What it does</h4>
      <p>The entry point of every pipeline. Every pipeline has exactly one trigger.</p>

      <h4>Trigger types</h4>
      <ul>
        <li><code>manual</code> — started by clicking Run in the editor.</li>
        <li><code>document.finalize</code> / <code>document.submit</code> / <code>document.comment</code> — fires on doc lifecycle events for a given document type.</li>
        <li><code>schedule</code> — cron expression (e.g. <code>0 9 * * 1-5</code>).</li>
        <li><code>webhook</code> — inbound HTTP POST at the configured path.</li>
      </ul>

      <h4>Fields</h4>
      <ul>
        <li><code>triggerType</code> — one of the above.</li>
        <li><code>documentTypeId</code> — required for <code>document.*</code>.</li>
        <li><code>schedule</code> / <code>webhookPath</code> — per type.</li>
      </ul>

      <h4>Wiring</h4>
      <p>One output handle <code>out</code> that fires downstream with <code>{'{ trigger, payload }'}</code> as the initial context.</p>
    </>
  ),

  // -------------------------------------------------------------------------
  // LLM
  // -------------------------------------------------------------------------
  llm: (
    <>
      <h4>What it does</h4>
      <p>Calls an LLM with a prompt template filled from pipeline context.</p>

      <h4>Provider &amp; model</h4>
      <ul>
        <li><code>anthropic</code> — Claude models (e.g. <code>claude-sonnet-4-6</code>).</li>
        <li><code>bedrock</code> — same models via AWS Bedrock.</li>
      </ul>

      <h4>Prompt templates</h4>
      <p>Interpolate with <code>{'{{ context.steps.X.output }}'}</code> or any dotted path into the run context.</p>

      <h4>Streaming</h4>
      <p>Toggle on to emit <code>pipeline.llm.token</code> events as text arrives; off for a single response.</p>

      <h4>Errors</h4>
      <p>The <code>error</code> handle routes downstream on LLM failure — retried per <code>RetryManager</code> policy before surfacing here.</p>
    </>
  ),

  // -------------------------------------------------------------------------
  // Transform
  // -------------------------------------------------------------------------
  transform: (
    <>
      <h4>What it does</h4>
      <p>Pure data transform — JSONPath, template string, or sandboxed JavaScript. No side effects.</p>

      <h4>When to use each</h4>
      <ul>
        <li><code>jsonpath</code> — extract a value, e.g. <code>$.document.body.sections[0]</code>.</li>
        <li><code>template</code> — shape a string from context, e.g. <code>{'Hi {{context.user.name}}'}</code>.</li>
        <li><code>javascript</code> — arbitrary logic; runs in an isolated sandbox with <code>context</code> as input.</li>
      </ul>

      <h4>Output</h4>
      <p><code>outputKey</code> scopes the result into <code>context.{'{outputKey}'}</code>. Leave blank to merge into the root context.</p>
    </>
  ),

  // -------------------------------------------------------------------------
  // Condition
  // -------------------------------------------------------------------------
  condition: (
    <>
      <h4>What it does</h4>
      <p>Branches the flow based on a boolean expression evaluated over context.</p>

      <h4>Expression language</h4>
      <p>JSONPath lookups combined with booleans and comparisons, e.g. <code>$.llm.output.sentiment == "positive"</code> or <code>$.score &gt; 0.8 &amp;&amp; $.reviewed</code>.</p>

      <h4>Wiring</h4>
      <p>Two output handles: <code>true</code> and <code>false</code>. Connected branches run; unconnected branches are skipped and their step is marked <code>skipped</code>.</p>
    </>
  ),

  // -------------------------------------------------------------------------
  // Action
  // -------------------------------------------------------------------------
  action: (
    <>
      <h4>What it does</h4>
      <p>Performs a side-effect: updates a doc, posts a comment, notifies, calls a webhook, or invokes an MCP tool.</p>

      <h4>Subtypes</h4>
      <ul>
        <li><code>update-document</code> — patch a document's body.</li>
        <li><code>post-comment</code> — append a comment thread entry.</li>
        <li><code>notify</code> — push notification to users/roles.</li>
        <li><code>webhook</code> — outbound HTTP request.</li>
        <li><code>mcp-tool</code> — invoke a registered MCP tool by name.</li>
      </ul>

      <h4>Idempotent flag</h4>
      <p>If <code>idempotent</code> is true, retries are safe after partial completion — the runtime may re-invoke the action without guarding against duplicates.</p>

      <h4>Errors</h4>
      <p>The <code>error</code> handle routes on failure (after retries), or fails the run if <code>onError</code> is <code>fail-run</code>.</p>
    </>
  ),

  // -------------------------------------------------------------------------
  // Fork
  // -------------------------------------------------------------------------
  fork: (
    <>
      <h4>What it does</h4>
      <p>Splits the flow into N parallel branches that all run concurrently against the same context snapshot.</p>

      <h4>Branch count</h4>
      <p>2-8 branches. Each branch exposes a handle <code>branch-0</code>, <code>branch-1</code>, etc.</p>

      <h4>Downstream</h4>
      <p>Typically paired with a <code>Join</code> to merge results. Without a Join, each branch terminates independently and the run completes when all tails finish.</p>
    </>
  ),

  // -------------------------------------------------------------------------
  // Join
  // -------------------------------------------------------------------------
  join: (
    <>
      <h4>What it does</h4>
      <p>Combines N parallel branches back into one flow.</p>

      <h4>Modes</h4>
      <ul>
        <li><code>all</code> — wait for every input.</li>
        <li><code>any</code> — fire as soon as the first input arrives; later inputs are ignored.</li>
        <li><code>n_of_m</code> — fire after <code>n</code> of <code>m</code> inputs complete.</li>
      </ul>

      <h4>Merge strategies</h4>
      <ul>
        <li><code>deep-merge</code> — recursive object merge.</li>
        <li><code>array-collect</code> — collect each branch's output into an array.</li>
        <li><code>last-writer-wins</code> — final branch to arrive replaces prior values.</li>
      </ul>

      <h4>Partial failures (§17.2)</h4>
      <p>In <code>all</code> mode a failed branch fails the run. In <code>any</code>/<code>n_of_m</code> failed branches count against the required total — the Join fires as soon as enough successes arrive.</p>
    </>
  ),

  // -------------------------------------------------------------------------
  // Approval
  // -------------------------------------------------------------------------
  approval: (
    <>
      <h4>What it does</h4>
      <p>Blocks the pipeline waiting for human approval. The run enters <code>awaiting_approval</code> until decisions are recorded.</p>

      <h4>Approvers</h4>
      <p>A list of users or roles. <code>requiredCount</code> controls how many approvals are needed (n-of-m).</p>

      <h4>Timeout</h4>
      <p>Optional <code>timeoutMs</code> with <code>timeoutAction</code> of <code>reject</code> or <code>approve</code> — decides the outcome if no one responds in time.</p>

      <h4>Wiring</h4>
      <p>Two output handles: <code>approved</code> and <code>rejected</code>. The flow resumes down the matching branch.</p>
    </>
  ),
};

export default docsContent;
