import { Router } from 'express';
import { profilesRouter } from './profiles';
import { socialRouter } from './social';
import { groupsRouter } from './groups';
import { groupMembersRouter } from './group-members';
import { roomsRouter } from './rooms';
import { groupRoomsRouter } from './group-rooms';
import { roomMembersRouter, myRoomsRouter } from './room-members';
import { postsRouter, userPostsRouter } from './posts';
import { commentsRouter } from './comments';

const router = Router();

router.use('/profiles', profilesRouter);
router.use('/social', socialRouter);
router.use('/groups', groupsRouter);
router.use('/groups/:groupId', groupMembersRouter);
router.use('/groups/:groupId/rooms', groupRoomsRouter);
router.use('/rooms', myRoomsRouter);
router.use('/rooms', roomsRouter);
router.use('/rooms/:roomId', roomMembersRouter);
router.use('/rooms/:roomId/posts', postsRouter);
router.use('/posts', userPostsRouter);
router.use('/rooms/:roomId/posts/:postId/comments', commentsRouter);

export default router;
