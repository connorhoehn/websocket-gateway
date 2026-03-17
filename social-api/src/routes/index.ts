import { Router } from 'express';
import { profilesRouter } from './profiles';

const router = Router();

router.use('/profiles', profilesRouter);

export default router;
