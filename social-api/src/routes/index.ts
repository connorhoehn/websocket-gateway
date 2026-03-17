import { Router } from 'express';
import { profilesRouter } from './profiles';
import { socialRouter } from './social';

const router = Router();

router.use('/profiles', profilesRouter);
router.use('/social', socialRouter);

export default router;
