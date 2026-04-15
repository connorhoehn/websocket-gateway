/**
 * Video session proxy routes — forwards requests to the videonowandlater (VNL)
 * API for creating/joining/ending hangout video sessions.
 *
 * The social-api authenticates against VNL's Cognito using a service account,
 * so the WSG frontend doesn't need VNL Cognito credentials.
 */

import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/auth';
import { getVnlAuthToken, VNL_API_URL } from '../lib/vnl-auth';

export const videoSessionsRouter = Router();

// POST /api/video/sessions — create a HANGOUT session on VNL
videoSessionsRouter.post('/sessions', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const vnlToken = await getVnlAuthToken();

    const vnlRes = await fetch(`${VNL_API_URL}/sessions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${vnlToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ sessionType: 'HANGOUT' }),
    });

    if (!vnlRes.ok) {
      const errorBody = await vnlRes.text().catch(() => 'Unknown error');
      console.error('[videoSessions] VNL create session failed:', vnlRes.status, errorBody);
      res.status(vnlRes.status).json({ error: `VNL API error: ${vnlRes.status}` });
      return;
    }

    const data = await vnlRes.json();
    res.status(201).json(data);
  } catch (err) {
    console.error('[videoSessions] POST /sessions error:', err);
    res.status(500).json({ error: 'Failed to create video session' });
  }
});

// POST /api/video/sessions/:sessionId/join — get IVS stage token
videoSessionsRouter.post('/sessions/:sessionId/join', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const { sessionId } = req.params;
    const vnlToken = await getVnlAuthToken();

    const vnlRes = await fetch(`${VNL_API_URL}/sessions/${sessionId}/join`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${vnlToken}`,
        'Content-Type': 'application/json',
      },
    });

    if (!vnlRes.ok) {
      const errorBody = await vnlRes.text().catch(() => 'Unknown error');
      console.error('[videoSessions] VNL join failed:', vnlRes.status, errorBody);
      res.status(vnlRes.status).json({ error: `VNL API error: ${vnlRes.status}` });
      return;
    }

    const data = await vnlRes.json();
    res.status(200).json(data);
  } catch (err) {
    console.error('[videoSessions] POST /sessions/:id/join error:', err);
    res.status(500).json({ error: 'Failed to join video session' });
  }
});

// POST /api/video/sessions/:sessionId/end — end a video session
videoSessionsRouter.post('/sessions/:sessionId/end', requireAuth, async (req: Request, res: Response): Promise<void> => {
  try {
    const { sessionId } = req.params;
    const vnlToken = await getVnlAuthToken();

    const vnlRes = await fetch(`${VNL_API_URL}/sessions/${sessionId}/end`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${vnlToken}`,
        'Content-Type': 'application/json',
      },
    });

    if (!vnlRes.ok) {
      const errorBody = await vnlRes.text().catch(() => 'Unknown error');
      console.error('[videoSessions] VNL end failed:', vnlRes.status, errorBody);
      res.status(vnlRes.status).json({ error: `VNL API error: ${vnlRes.status}` });
      return;
    }

    const data = await vnlRes.json();
    res.status(200).json(data);
  } catch (err) {
    console.error('[videoSessions] POST /sessions/:id/end error:', err);
    res.status(500).json({ error: 'Failed to end video session' });
  }
});
