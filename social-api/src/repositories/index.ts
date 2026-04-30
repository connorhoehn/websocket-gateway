import { docClient } from '../lib/aws-clients';
import { ProfileRepository } from './ProfileRepository';
import { RoomRepository } from './RoomRepository';
import { GroupRepository } from './GroupRepository';
import { SectionItemRepository } from './SectionItemRepository';
import { DocumentSectionRepository } from './DocumentSectionRepository';
import { DocumentCommentRepository } from './DocumentCommentRepository';
import { SectionReviewRepository } from './SectionReviewRepository';
import { VideoSessionRepository } from './VideoSessionRepository';
import { DocumentTypeRepository } from './DocumentTypeRepository';
import { TypedDocumentRepository } from './TypedDocumentRepository';

// Singleton instances — share the same docClient across all repositories
export const profileRepo = new ProfileRepository(docClient);
export const roomRepo = new RoomRepository(docClient);
export const groupRepo = new GroupRepository(docClient);
export const sectionItemRepo = new SectionItemRepository(docClient);
export const documentSectionRepo = new DocumentSectionRepository(docClient);
export const documentCommentRepo = new DocumentCommentRepository(docClient);
export const sectionReviewRepo = new SectionReviewRepository(docClient);
export const videoSessionRepo = new VideoSessionRepository(docClient);
export const documentTypeRepo = new DocumentTypeRepository(docClient);
export const typedDocumentRepo = new TypedDocumentRepository(docClient);

export { BaseRepository } from './BaseRepository';
export { ProfileRepository, ProfileItem } from './ProfileRepository';
export { RoomRepository, RoomItem, RoomMemberItem } from './RoomRepository';
export { GroupRepository, GroupItem, GroupMemberItem } from './GroupRepository';
export { SectionItemRepository, SectionItemFields, CreateSectionItemInput } from './SectionItemRepository';
export { DocumentSectionRepository, DocumentSectionFields, CreateDocumentSectionInput } from './DocumentSectionRepository';
export { DocumentCommentRepository, DocumentComment } from './DocumentCommentRepository';
export { SectionReviewRepository, SectionReview } from './SectionReviewRepository';
export { VideoSessionRepository, VideoSessionRecord, VideoSessionParticipant } from './VideoSessionRepository';
export {
  DocumentTypeRepository,
  DocumentTypeItem,
  DocumentTypeFieldItem,
  DocumentTypeFieldKind,
  DocumentTypeFieldWidget,
  DocumentTypeFieldCardinality,
} from './DocumentTypeRepository';
export {
  TypedDocumentRepository,
  TypedDocumentItem,
  TypedDocumentValue,
} from './TypedDocumentRepository';
