import { Request, Response, NextFunction } from 'express';
import { roomRepo } from '../repositories';

/**
 * Express middleware that gates access to room-scoped routes.
 * Checks that the authenticated user (req.user.sub) is a member
 * of the room identified by req.params.roomId.
 *
 * Returns 403 if the user is not a member.
 *
 * Usage:
 *   router.use(requireRoomMembership);
 *   // or on specific routes:
 *   router.post('/', requireRoomMembership, handler);
 */
export async function requireRoomMembership(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  // In local dev (SKIP_AUTH=true), skip membership check so any dev identity can post
  if (process.env.SKIP_AUTH === 'true') {
    next();
    return;
  }

  try {
    const { roomId } = req.params;
    const userId = req.user!.sub;

    if (!roomId) {
      res.status(400).json({ error: 'roomId is required' });
      return;
    }

    const isMember = await roomRepo.isMember(roomId, userId);
    if (!isMember) {
      res.status(403).json({ error: 'You must be a member of this room' });
      return;
    }

    next();
  } catch (err) {
    console.error('[require-membership] Error checking membership:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
}
