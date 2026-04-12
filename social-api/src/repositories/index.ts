import { docClient } from '../lib/aws-clients';
import { ProfileRepository } from './ProfileRepository';
import { RoomRepository } from './RoomRepository';
import { GroupRepository } from './GroupRepository';

// Singleton instances — share the same docClient across all repositories
export const profileRepo = new ProfileRepository(docClient);
export const roomRepo = new RoomRepository(docClient);
export const groupRepo = new GroupRepository(docClient);

export { BaseRepository } from './BaseRepository';
export { ProfileRepository, ProfileItem } from './ProfileRepository';
export { RoomRepository, RoomItem, RoomMemberItem } from './RoomRepository';
export { GroupRepository, GroupItem, GroupMemberItem } from './GroupRepository';
