#!/usr/bin/env node

/**
 * MCP (Model Context Protocol) server for document management.
 *
 * Implements the JSON-RPC over stdio transport that MCP clients (Claude Desktop,
 * Claude Code, etc.) expect.  Each tool maps to one or two REST API calls against
 * the social-api running on localhost:3001.
 *
 * Usage:
 *   node document-mcp-server.js                        # default: http://localhost:3001/api
 *   API_BASE_URL=http://host:3001/api node document-mcp-server.js
 *   AUTH_TOKEN=<jwt> node document-mcp-server.js        # static token for all calls
 */

const { DocumentToolHandler } = require('./tool-handler');

// ---------------------------------------------------------------------------
// Tool definitions — the schema exposed to MCP clients
// ---------------------------------------------------------------------------

const TOOLS = [
  {
    name: 'document_list',
    description: 'List all documents with metadata (title, status, type, created by)',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'document_get',
    description: 'Get full document with sections, items, comments, reviews, and workflows',
    inputSchema: {
      type: 'object',
      properties: {
        documentId: { type: 'string', description: 'Document ID' },
      },
      required: ['documentId'],
    },
  },
  {
    name: 'document_get_comments',
    description: 'Get comments for a document, optionally filtered by section',
    inputSchema: {
      type: 'object',
      properties: {
        documentId: { type: 'string', description: 'Document ID' },
        sectionId: { type: 'string', description: 'Optional section filter' },
      },
      required: ['documentId'],
    },
  },
  {
    name: 'document_add_comment',
    description: 'Add a comment to a document section. Supports threaded replies via parentCommentId.',
    inputSchema: {
      type: 'object',
      properties: {
        documentId: { type: 'string', description: 'Document ID' },
        sectionId: { type: 'string', description: 'Section ID to attach the comment to' },
        text: { type: 'string', description: 'Comment text (max 10000 chars)' },
        parentCommentId: { type: 'string', description: 'Reply to this comment (creates a thread)' },
      },
      required: ['documentId', 'sectionId', 'text'],
    },
  },
  {
    name: 'document_get_reviews',
    description: 'Get review/approval status for a document, optionally scoped to a section',
    inputSchema: {
      type: 'object',
      properties: {
        documentId: { type: 'string', description: 'Document ID' },
        sectionId: { type: 'string', description: 'Optional section ID to scope reviews' },
      },
      required: ['documentId'],
    },
  },
  {
    name: 'document_submit_review',
    description: 'Submit a review for a section (e.g. approved, changes_requested, reviewed)',
    inputSchema: {
      type: 'object',
      properties: {
        documentId: { type: 'string', description: 'Document ID' },
        sectionId: { type: 'string', description: 'Section ID to review' },
        status: { type: 'string', description: 'Review status: approved, changes_requested, reviewed' },
        comment: { type: 'string', description: 'Optional review comment' },
      },
      required: ['documentId', 'sectionId', 'status'],
    },
  },
  {
    name: 'document_get_items',
    description: 'Get action items/tasks for a specific section of a document',
    inputSchema: {
      type: 'object',
      properties: {
        documentId: { type: 'string', description: 'Document ID' },
        sectionId: { type: 'string', description: 'Section ID' },
      },
      required: ['documentId', 'sectionId'],
    },
  },
  {
    name: 'document_update_item',
    description: 'Update an action item (status, assignee, priority, dueDate, notes, text)',
    inputSchema: {
      type: 'object',
      properties: {
        documentId: { type: 'string', description: 'Document ID' },
        sectionId: { type: 'string', description: 'Section ID' },
        itemId: { type: 'string', description: 'Item ID' },
        text: { type: 'string', description: 'Updated item text' },
        status: { type: 'string', description: 'New status (open, in_progress, done)' },
        assignee: { type: 'string', description: 'User ID to assign to' },
        priority: { type: 'string', description: 'Priority level (low, medium, high, urgent)' },
        dueDate: { type: 'string', description: 'Due date (ISO 8601)' },
        notes: { type: 'string', description: 'Additional notes' },
      },
      required: ['documentId', 'sectionId', 'itemId'],
    },
  },
  {
    name: 'document_get_workflow',
    description: 'Get approval workflow status and progress for a document',
    inputSchema: {
      type: 'object',
      properties: {
        documentId: { type: 'string', description: 'Document ID' },
        workflowId: { type: 'string', description: 'Optional workflow ID for a specific workflow' },
      },
      required: ['documentId'],
    },
  },
  {
    name: 'document_advance_workflow',
    description: 'Advance an approval workflow step (approve, reject, or skip)',
    inputSchema: {
      type: 'object',
      properties: {
        documentId: { type: 'string', description: 'Document ID' },
        workflowId: { type: 'string', description: 'Workflow ID' },
        action: { type: 'string', enum: ['approve', 'reject', 'skip'], description: 'Action to take' },
        comment: { type: 'string', description: 'Optional comment for the action' },
      },
      required: ['documentId', 'workflowId', 'action'],
    },
  },
  {
    name: 'document_get_activity',
    description: 'Get recent activity events for the current user across all documents',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Max events to return (default 20, max 100)' },
      },
    },
  },
  {
    name: 'my_pending_items',
    description: 'Get all action items assigned to the current user across all documents',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', description: 'Filter by status (e.g. pending, open, in_progress)' },
      },
    },
  },
  {
    name: 'my_pending_reviews',
    description: 'Get all pending review/approval requests for the current user',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'my_pending_workflows',
    description: 'Get all pending workflow approvals for the current user',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
];

// ---------------------------------------------------------------------------
// MCP protocol constants
// ---------------------------------------------------------------------------

const SERVER_INFO = {
  name: 'websocket-gateway-documents',
  version: '1.0.0',
};

const SERVER_CAPABILITIES = {
  tools: {},
};

// ---------------------------------------------------------------------------
// JSON-RPC over stdio transport
// ---------------------------------------------------------------------------

const apiBase = process.env.API_BASE_URL || 'http://localhost:3001/api';
const authToken = process.env.AUTH_TOKEN || null;
const handler = new DocumentToolHandler(apiBase);

let inputBuffer = '';

process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  inputBuffer += chunk;

  // MCP uses newline-delimited JSON-RPC messages
  let newlineIdx;
  while ((newlineIdx = inputBuffer.indexOf('\n')) !== -1) {
    const line = inputBuffer.slice(0, newlineIdx).trim();
    inputBuffer = inputBuffer.slice(newlineIdx + 1);
    if (line.length > 0) {
      handleLine(line);
    }
  }
});

process.stdin.on('end', () => {
  process.exit(0);
});

/**
 * Parse and dispatch a single JSON-RPC line.
 */
async function handleLine(line) {
  let request;
  try {
    request = JSON.parse(line);
  } catch {
    sendResponse({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
    return;
  }

  const { id, method, params } = request;

  try {
    switch (method) {
      case 'initialize':
        sendResponse({
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: '2024-11-05',
            serverInfo: SERVER_INFO,
            capabilities: SERVER_CAPABILITIES,
          },
        });
        break;

      case 'notifications/initialized':
        // Client acknowledgement — no response needed for notifications
        break;

      case 'tools/list':
        sendResponse({
          jsonrpc: '2.0',
          id,
          result: { tools: TOOLS },
        });
        break;

      case 'tools/call': {
        const { name, arguments: args } = params || {};
        // Use token from args._authToken if provided, else fall back to env
        const token = args?._authToken || authToken;
        // Strip internal fields before passing to handler
        const cleanArgs = { ...args };
        delete cleanArgs._authToken;

        try {
          const result = await handler.handleToolCall(name, cleanArgs, token);
          sendResponse({
            jsonrpc: '2.0',
            id,
            result: {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify(result, null, 2),
                },
              ],
            },
          });
        } catch (err) {
          sendResponse({
            jsonrpc: '2.0',
            id,
            result: {
              content: [
                {
                  type: 'text',
                  text: JSON.stringify({ error: err.message }),
                },
              ],
              isError: true,
            },
          });
        }
        break;
      }

      default:
        // Unknown method
        if (id !== undefined) {
          sendResponse({
            jsonrpc: '2.0',
            id,
            error: { code: -32601, message: `Method not found: ${method}` },
          });
        }
        break;
    }
  } catch (err) {
    if (id !== undefined) {
      sendResponse({
        jsonrpc: '2.0',
        id,
        error: { code: -32603, message: `Internal error: ${err.message}` },
      });
    }
  }
}

/**
 * Write a JSON-RPC response to stdout (newline-delimited).
 */
function sendResponse(response) {
  process.stdout.write(JSON.stringify(response) + '\n');
}

// Export for testing
module.exports = { TOOLS, SERVER_INFO };
