/**
 * useActiveSpeaker hook - detects active speaker using Web Audio API
 * Monitors audio levels via AnalyserNode and returns the loudest participant above threshold
 */

import { useState, useEffect } from 'react';

interface ParticipantWithStreams {
  participantId: string;
  streams: MediaStream[];
}

interface UseActiveSpeakerOptions {
  participants: ParticipantWithStreams[];
  threshold?: number; // dB threshold for "speaking" detection
  smoothingTimeConstant?: number; // Frequency smoothing
}

export function useActiveSpeaker({
  participants,
  threshold = -40,
  smoothingTimeConstant = 0.8,
}: UseActiveSpeakerOptions) {
  const [activeSpeakerId, setActiveSpeakerId] = useState<string | null>(null);

  useEffect(() => {
    const audioContextMap = new Map<string, AudioContext>();
    const analyserMap = new Map<string, AnalyserNode>();
    let intervalId: ReturnType<typeof setInterval>;

    // Set up audio analyzers for each participant with audio tracks
    participants.forEach((participant) => {
      if (participant.streams.length === 0) return;

      const audioTracks = participant.streams[0].getAudioTracks();
      if (audioTracks.length === 0) return;

      try {
        // Create AudioContext and AnalyserNode
        const audioContext = new AudioContext();
        const analyser = audioContext.createAnalyser();
        analyser.fftSize = 512;
        analyser.smoothingTimeConstant = smoothingTimeConstant;

        // Create media stream source and connect to analyser
        const source = audioContext.createMediaStreamSource(participant.streams[0]);
        source.connect(analyser);

        audioContextMap.set(participant.participantId, audioContext);
        analyserMap.set(participant.participantId, analyser);
      } catch (error) {
        console.error('Failed to create audio analyzer:', error);
      }
    });

    // Poll audio levels every 100ms
    intervalId = setInterval(() => {
      let loudestParticipantId: string | null = null;
      let maxVolume = threshold;

      analyserMap.forEach((analyser, participantId) => {
        const dataArray = new Float32Array(analyser.frequencyBinCount);
        analyser.getFloatTimeDomainData(dataArray);

        // Calculate RMS volume
        let sumSquares = 0;
        for (let i = 0; i < dataArray.length; i++) {
          sumSquares += dataArray[i] * dataArray[i];
        }
        const rms = Math.sqrt(sumSquares / dataArray.length);

        // Convert to dB
        const db = 20 * Math.log10(rms);

        // Track loudest participant above threshold
        if (db > maxVolume) {
          maxVolume = db;
          loudestParticipantId = participantId;
        }
      });

      setActiveSpeakerId(loudestParticipantId);
    }, 100);

    // Cleanup
    return () => {
      clearInterval(intervalId);
      audioContextMap.forEach((audioContext) => {
        audioContext.close().catch(console.error);
      });
    };
  }, [participants, threshold, smoothingTimeConstant]);

  return { activeSpeakerId };
}
