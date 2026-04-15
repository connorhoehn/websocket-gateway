/**
 * useHangoutEmbed — embeddable version of useHangout.
 *
 * Takes a raw IVS Stage token (obtained externally) and manages only the
 * Stage SDK lifecycle: camera/mic acquisition, participant tracking, mute/camera toggle.
 * No HTTP calls, no auth — the token is provided by the consumer.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { Stage, type StageStrategy, SubscribeType, StageEvents, LocalStageStream } from 'amazon-ivs-web-broadcast';
import type { HangoutParticipant } from './types';

export interface UseHangoutEmbedOptions {
  /** IVS RealTime Stage participant token (from CreateParticipantToken API). */
  stageToken: string;
  /** Current user's identifier (displayed in participant list). */
  userId: string;
  /** Participant ID returned by the join API. */
  participantId: string;
}

export interface UseHangoutEmbedReturn {
  /** Ref to attach to a <video> element for local camera preview. */
  localVideoRef: React.RefObject<HTMLVideoElement | null>;
  /** All participants (including local user). */
  participants: HangoutParticipant[];
  /** True once the Stage has been successfully joined. */
  isJoined: boolean;
  /** Error message if join or media acquisition failed. */
  error: string | null;
  /** Whether the local user is sharing their screen. */
  isScreenSharing: boolean;
  /** Toggle audio mute. */
  toggleMute: (muted: boolean) => void;
  /** Toggle camera on/off. */
  toggleCamera: (enabled: boolean) => void;
  /** Start sharing screen. */
  startScreenShare: () => Promise<void>;
  /** Stop sharing screen. */
  stopScreenShare: () => void;
  /** Leave the stage and clean up. */
  leave: () => void;
}

export function useHangoutEmbed({
  stageToken,
  userId,
  participantId,
}: UseHangoutEmbedOptions): UseHangoutEmbedReturn {
  const [participants, setParticipants] = useState<HangoutParticipant[]>([]);
  const [isJoined, setIsJoined] = useState(false);
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const localStageStreamsRef = useRef<LocalStageStream[]>([]);
  const stageRef = useRef<Stage | null>(null);

  useEffect(() => {
    if (!stageToken) return;

    let mounted = true;

    const joinStage = async () => {
      setError(null);
      try {
        // Acquire camera + microphone
        const localStream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 1280 }, height: { ideal: 720 } },
          audio: true,
        });

        if (!mounted) {
          localStream.getTracks().forEach(t => t.stop());
          return;
        }

        localStreamRef.current = localStream;

        // Wrap tracks as LocalStageStream for IVS SDK
        const stageStreams = localStream.getTracks().map(
          (track) => new LocalStageStream(track),
        );
        localStageStreamsRef.current = stageStreams;

        // Attach local preview
        if (localVideoRef.current) {
          localVideoRef.current.srcObject = localStream;
        }

        // Stage strategy: publish all, subscribe to all
        const strategy: StageStrategy = {
          stageStreamsToPublish: (): LocalStageStream[] => localStageStreamsRef.current,
          shouldPublishParticipant: () => true,
          shouldSubscribeToParticipant: () => SubscribeType.AUDIO_VIDEO,
        };

        const stage = new Stage(stageToken, strategy);
        stageRef.current = stage;

        // Participant joined
        stage.on(StageEvents.STAGE_PARTICIPANT_JOINED, (p: any) => {
          if (!mounted || p.isLocal) return;
          setParticipants((prev) => [
            ...prev,
            {
              participantId: p.id,
              userId: p.attributes?.userId || p.id,
              isLocal: false,
              streams: [],
              isSpeaking: false,
            },
          ]);
        });

        // Participant left
        stage.on(StageEvents.STAGE_PARTICIPANT_LEFT, (p: any) => {
          if (!mounted) return;
          setParticipants((prev) => prev.filter((x) => x.participantId !== p.id));
        });

        // Participant streams added — separate screen share from camera/mic
        stage.on(StageEvents.STAGE_PARTICIPANT_STREAMS_ADDED, (p: any, streams: any[]) => {
          if (!mounted || p.isLocal) return;
          const screenTracks: MediaStreamTrack[] = [];
          const cameraTracks: MediaStreamTrack[] = [];
          for (const s of streams) {
            const track = s.mediaStreamTrack as MediaStreamTrack | undefined;
            if (!track) continue;
            if (track.contentHint === 'detail' || track.label?.toLowerCase().includes('screen')) {
              screenTracks.push(track);
            } else {
              cameraTracks.push(track);
            }
          }
          const cameraStream = cameraTracks.length > 0 ? new MediaStream(cameraTracks) : undefined;
          const screenStream = screenTracks.length > 0 ? new MediaStream(screenTracks) : undefined;
          setParticipants((prev) =>
            prev.map((x) => {
              if (x.participantId !== p.id) return x;
              return {
                ...x,
                streams: cameraStream ? [cameraStream] : x.streams,
                screenStream: screenStream || x.screenStream,
              };
            }),
          );
        });

        // Join
        await stage.join();

        if (!mounted) {
          stage.leave();
          return;
        }

        // Add local participant first
        setParticipants((prev) => [
          {
            participantId,
            userId,
            isLocal: true,
            streams: [localStream],
            isSpeaking: false,
          },
          ...prev,
        ]);

        setIsJoined(true);
      } catch (err: any) {
        if (mounted) {
          setError(err.message);
          console.error('[useHangoutEmbed] Failed to join stage:', err);
        }
      }
    };

    joinStage();

    return () => {
      mounted = false;
      if (stageRef.current) {
        stageRef.current.leave();
        stageRef.current = null;
      }
      localStageStreamsRef.current = [];
      if (localStreamRef.current) {
        localStreamRef.current.getTracks().forEach((track) => track.stop());
        localStreamRef.current = null;
      }
      if (screenStreamRef.current) {
        screenStreamRef.current.getTracks().forEach((track) => track.stop());
        screenStreamRef.current = null;
      }
      setParticipants([]);
      setIsJoined(false);
      setIsScreenSharing(false);
    };
  }, [stageToken, userId, participantId]);

  const toggleMute = useCallback((muted: boolean) => {
    if (!localStreamRef.current) return;
    const audioTrack = localStreamRef.current.getAudioTracks()[0];
    if (audioTrack) audioTrack.enabled = !muted;
    localStageStreamsRef.current.forEach((lss) => {
      if (lss.mediaStreamTrack.kind === 'audio') lss.setMuted(muted);
    });
  }, []);

  const stopScreenShare = useCallback(() => {
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach((t) => t.stop());
      screenStreamRef.current = null;
    }
    localStageStreamsRef.current = localStageStreamsRef.current.filter(
      (lss) => lss.mediaStreamTrack.contentHint !== 'detail',
    );
    stageRef.current?.refreshStrategy();
    setParticipants((prev) => prev.map((p) => p.isLocal ? { ...p, screenStream: undefined } : p));
    setIsScreenSharing(false);
  }, []);

  const startScreenShare = useCallback(async () => {
    try {
      const screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: { cursor: 'always' } as any,
        audio: false,
      });
      screenStreamRef.current = screenStream;
      const videoTrack = screenStream.getVideoTracks()[0];
      videoTrack.contentHint = 'detail';
      const screenStageStream = new LocalStageStream(videoTrack);
      localStageStreamsRef.current = [...localStageStreamsRef.current, screenStageStream];
      stageRef.current?.refreshStrategy();
      setParticipants((prev) => prev.map((p) => p.isLocal ? { ...p, screenStream } : p));
      setIsScreenSharing(true);
      videoTrack.addEventListener('ended', () => { stopScreenShare(); });
    } catch (err: any) {
      if (err.name === 'AbortError' || err.name === 'NotAllowedError') return;
      console.error('[useHangoutEmbed] Screen share failed:', err);
    }
  }, [stopScreenShare]);

  const toggleCamera = useCallback((enabled: boolean) => {
    if (!localStreamRef.current) return;
    const videoTrack = localStreamRef.current.getVideoTracks()[0];
    if (videoTrack) videoTrack.enabled = enabled;
    localStageStreamsRef.current.forEach((lss) => {
      if (lss.mediaStreamTrack.kind === 'video') lss.setMuted(!enabled);
    });
  }, []);

  const leave = useCallback(() => {
    if (stageRef.current) {
      stageRef.current.leave();
      stageRef.current = null;
    }
    localStageStreamsRef.current = [];
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
    }
    if (screenStreamRef.current) {
      screenStreamRef.current.getTracks().forEach((track) => track.stop());
      screenStreamRef.current = null;
    }
    setParticipants([]);
    setIsJoined(false);
    setIsScreenSharing(false);
  }, []);

  return { localVideoRef, participants, isJoined, isScreenSharing, error, toggleMute, toggleCamera, startScreenShare, stopScreenShare, leave };
}
