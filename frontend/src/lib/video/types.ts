/**
 * Shared types for embeddable hangout components.
 * Used by useHangoutEmbed, VideoGridEmbed, ParticipantTileEmbed.
 */

export interface HangoutParticipant {
  participantId: string;
  userId: string;
  isLocal: boolean;
  streams: MediaStream[];
  isSpeaking: boolean;
  screenStream?: MediaStream;
}
