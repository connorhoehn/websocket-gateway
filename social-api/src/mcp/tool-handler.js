/**
 * DocumentToolHandler — maps MCP tool calls to REST API calls against social-api.
 *
 * This is a thin translation layer.  Each tool maps to one or two HTTP requests
 * and returns the JSON body directly.
 */

class DocumentToolHandler {
  /**
   * @param {string} apiBaseUrl  Base URL for social-api (no trailing slash).
   */
  constructor(apiBaseUrl = 'http://localhost:3001/api') {
    this.apiBase = apiBaseUrl;
  }

  // ---------------------------------------------------------------------------
  // Dispatcher
  // ---------------------------------------------------------------------------

  /**
   * Route a tool call to the appropriate handler method.
   *
   * @param {string} toolName   One of the tool names from TOOLS.
   * @param {object} args       Tool input arguments.
   * @param {string} authToken  Bearer token forwarded to the REST API.
   * @returns {Promise<object>} JSON-serializable result.
   */
  async handleToolCall(toolName, args, authToken) {
    switch (toolName) {
      case 'document_list':
        return this.listDocuments(authToken);
      case 'document_get':
        return this.getDocument(args.documentId, authToken);
      case 'document_get_comments':
        return this.getComments(args, authToken);
      case 'document_add_comment':
        return this.addComment(args, authToken);
      case 'document_get_reviews':
        return this.getReviews(args, authToken);
      case 'document_submit_review':
        return this.submitReview(args, authToken);
      case 'document_get_items':
        return this.getItems(args, authToken);
      case 'document_update_item':
        return this.updateItem(args, authToken);
      case 'document_get_activity':
        return this.getActivity(args, authToken);
      case 'my_pending_items':
        return this.myPendingItems(args, authToken);
      case 'my_pending_reviews':
        return this.myPendingReviews(authToken);
      default:
        throw new Error(`Unknown tool: ${toolName}`);
    }
  }

  // ---------------------------------------------------------------------------
  // HTTP helpers
  // ---------------------------------------------------------------------------

  /** @private */
  async _get(path, authToken) {
    const res = await fetch(`${this.apiBase}${path}`, {
      headers: this._headers(authToken),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`GET ${path} failed (${res.status}): ${body}`);
    }
    return res.json();
  }

  /** @private */
  async _post(path, body, authToken) {
    const res = await fetch(`${this.apiBase}${path}`, {
      method: 'POST',
      headers: { ...this._headers(authToken), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`POST ${path} failed (${res.status}): ${text}`);
    }
    return res.json();
  }

  /** @private */
  async _patch(path, body, authToken) {
    const res = await fetch(`${this.apiBase}${path}`, {
      method: 'PATCH',
      headers: { ...this._headers(authToken), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`PATCH ${path} failed (${res.status}): ${text}`);
    }
    return res.json();
  }

  /** @private */
  _headers(authToken) {
    return authToken ? { Authorization: `Bearer ${authToken}` } : {};
  }

  // ---------------------------------------------------------------------------
  // Tool implementations
  // ---------------------------------------------------------------------------

  /**
   * List all documents.
   * There is no dedicated list endpoint yet, so we scan the crdt-documents
   * DynamoDB table directly.  If a list endpoint is added later, swap this out.
   */
  async listDocuments(authToken) {
    // Use the DynamoDB scan approach via a lightweight proxy.
    // For now we hit /documents/<dummy>/export and catch 404 — but that is
    // wasteful.  Instead we expose a scan helper inline.  This keeps the MCP
    // server self-contained without requiring a new REST route.
    const { ScanCommand } = await import('@aws-sdk/lib-dynamodb');
    const { docClient } = await import('../lib/aws-clients.js');

    const TABLE = process.env.DYNAMODB_DOCUMENTS_TABLE || 'crdt-documents';
    const result = await docClient.send(new ScanCommand({
      TableName: TABLE,
      ProjectionExpression: 'documentId, title, #s, #t, createdBy, createdAt, updatedAt, icon, description',
      ExpressionAttributeNames: { '#s': 'status', '#t': 'type' },
    }));

    return {
      documents: (result.Items ?? []).map((item) => ({
        id: item.documentId,
        title: item.title ?? 'Untitled',
        type: item.type ?? 'custom',
        status: item.status ?? 'draft',
        createdBy: item.createdBy ?? 'unknown',
        createdAt: item.createdAt,
        updatedAt: item.updatedAt,
        ...(item.icon ? { icon: item.icon } : {}),
        ...(item.description ? { description: item.description } : {}),
      })),
    };
  }

  /** Get full document with sections, items, comments, and reviews. */
  async getDocument(documentId, authToken) {
    return this._get(`/documents/${documentId}/export?format=json`, authToken);
  }

  /** Get comments, optionally filtered by section. */
  async getComments({ documentId, sectionId }, authToken) {
    const qs = sectionId ? `?sectionId=${encodeURIComponent(sectionId)}` : '';
    return this._get(`/documents/${documentId}/comments${qs}`, authToken);
  }

  /** Add a comment (or threaded reply) to a document section. */
  async addComment({ documentId, sectionId, text, parentCommentId }, authToken) {
    return this._post(`/documents/${documentId}/comments`, {
      sectionId,
      text,
      ...(parentCommentId ? { parentCommentId } : {}),
    }, authToken);
  }

  /** Get reviews for a document, optionally scoped to a section. */
  async getReviews({ documentId, sectionId }, authToken) {
    if (sectionId) {
      return this._get(`/documents/${documentId}/sections/${sectionId}/reviews`, authToken);
    }
    return this._get(`/documents/${documentId}/reviews`, authToken);
  }

  /** Submit a review for a section. */
  async submitReview({ documentId, sectionId, status, comment }, authToken) {
    return this._post(`/documents/${documentId}/sections/${sectionId}/reviews`, {
      status,
      ...(comment ? { comment } : {}),
    }, authToken);
  }

  /** Get items for a section. */
  async getItems({ documentId, sectionId }, authToken) {
    return this._get(`/documents/${documentId}/sections/${sectionId}/items`, authToken);
  }

  /** Update an action item's fields. */
  async updateItem({ documentId, sectionId, itemId, ...updates }, authToken) {
    const body = {};
    for (const key of ['text', 'status', 'assignee', 'priority', 'dueDate', 'notes']) {
      if (updates[key] !== undefined) body[key] = updates[key];
    }
    return this._patch(`/documents/${documentId}/sections/${sectionId}/items/${itemId}`, body, authToken);
  }

  /** Get activity feed for current user. */
  async getActivity({ limit }, authToken) {
    const qs = limit ? `?limit=${limit}` : '';
    return this._get(`/activity${qs}`, authToken);
  }

  /** Get action items assigned to the current user. */
  async myPendingItems({ status }, authToken) {
    const qs = status ? `?status=${encodeURIComponent(status)}` : '';
    return this._get(`/items/mine${qs}`, authToken);
  }

  /** Get pending review requests for the current user. */
  async myPendingReviews(authToken) {
    return this._get('/reviews/mine', authToken);
  }
}

module.exports = { DocumentToolHandler };
