export enum AudioLevel {
  SILENT = "silent",
  LOW = "low",
  HIGH = "high",
}

export enum MediaAggregationType {
  NONE = "NONE",
  COMPOSITE = "COMPOSITE",
}

export enum MediaType {
  AUDIO = "AUDIO",
  VIDEO = "VIDEO",
  APPLICATION = "APPLICATION",
}

export enum EndpointType {
  ENDPOINT = "ENDPOINT",
  CALL_ID = "CALL_ID",
  PHONE_NUMBER = "PHONE_NUMBER",
}

export type AudioLevelChangeHandler = { (audioLevel: AudioLevel): void };

/**
 * @property {string} endpointToken - The endpoint token is a "string" in the JWT format.
 * To be possible the token utilization, parse the token using "jwt_decode" function, the expected result should be a {@link JwtPayload} object.
 */
export interface RtcAuthParams {
  endpointToken: string;
}

export interface RtcOptions {
  websocketUrl?: string;
  iceServers?: RTCIceServer[];
  iceTransportPolicy?: RTCIceTransportPolicy;
  /**
   * When true (default), the gateway sets autoAccepted=true on the streamAvailable
   * notification so the SDK skips the accept/decline prompt and the call connects
   * immediately. Set to false to show a prompt and require the user to call
   * acceptStream or declineStream.
   */
  autoAccept?: boolean;
}

export interface RtcStream {
  mediaTypes: MediaType[];
  mediaStream: MediaStream;
  callId?: string;
  autoAccepted?: boolean;
}

export class BandwidthRtcError extends Error {}

export interface ReadyMetadata {
  endpointId: string;
  deviceId: string;
  territory: string; // TODO enum
  region: string; // TODO enum
}

export interface OutboundConnectionResult {
  accepted: boolean;
}

export interface HangupResult {
  result: string;
}
