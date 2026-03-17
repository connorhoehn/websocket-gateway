import { Router } from 'express';
import { profilesRouter } from './profiles';
import { socialRouter } from './social';
import { groupsRouter } from './groups';

const router = Router();

router.use('/profiles', profilesRouter);
router.use('/social', socialRouter);
router.use('/groups', groupsRouter);

export default router;
