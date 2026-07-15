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
   * When true (default), the gateway opens its egress gate as soon as the call
   * bridges, so audio flows immediately and onStreamAvailable reports
   * autoAccepted=true. Set to false to park the call (ringing, no audio) and
   * prompt the user: call acceptStream to open the gate or declineStream to end
   * the call. Passed to the gateway via setMediaPreferences.
   */
  autoAccept?: boolean;
}

export interface RtcStream {
  mediaTypes: MediaType[];
  mediaStream: MediaStream;
  /** Identity of the caller, from the gateway's subscribe offer track metadata. */
  from?: string;
  /** Kind of the caller identity (e.g. "call", "endpoint"). */
  fromType?: string;
  /**
   * True when the gateway auto-accepted the stream (audio already flowing). When
   * false, the call is parked/ringing: prompt the user and call acceptStream or
   * declineStream.
   */
  autoAccepted?: boolean;
  /** Free-form tags forwarded by the gateway, if any. */
  tags?: string;
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
