if (globalThis.window) {
  require("webrtc-adapter");
}
import { jwtDecode } from "jwt-decode";

import {
  AudioLevelChangeHandler,
  BandwidthRtcError,
  EndpointType,
  HangupResult,
  OutboundConnectionResult,
  RtcAuthParams,
  RtcOptions,
  RtcStream,
} from "./types";
import logger, { LogLevel } from "./logging";

import { BandwidthRtc as BandwidthRtcV1 } from "./v1/bandwidthRtc";
import { CodecPreferences, ReadyMetadata } from "./v1/types";

class BandwidthRtc {
  // Event handlers
  private streamAvailableHandler?: { (event: RtcStream): void };
  private streamUnavailableHandler?: { (event: RtcStream): void };
  private readyHandler?: { (readyMetadata: ReadyMetadata): void };

  private logLevel?: LogLevel;
  private delegate?: BandwidthRtcV1;

  constructor(logLevel?: LogLevel) {
    if (logLevel) {
      this.setLogLevel(logLevel);
    }
    this.setMicEnabled = this.setMicEnabled.bind(this);
    this.setCameraEnabled = this.setCameraEnabled.bind(this);
    this.delegate = this.createDelegateObject();
  }

  /**
   * Creates the delegate object using the specific version
   * @param authParams connection credentials with version
   * @returns
   */
  private createDelegateObject(): BandwidthRtcV1 {
    // TODO: clean
    // const rtcVersion = jwtPayload.v?.toLowerCase();

    let delegate: BandwidthRtcV1 | undefined;

    // logger.info(`Using device API version ${rtcVersion}`);
    // switch (rtcVersion) {
    //   case "v3": {
    delegate = new BandwidthRtcV1(this.logLevel);
    //     break;
    //   }
    //   default: {
    //     throw new BandwidthRtcError(`${rtcVersion} is not supported by the Bandwidth WebRTC SDK.`);
    //   }
    // }

    return delegate;
  }

  /**
   * Connect to the Bandwidth WebRTC platform
   * @param authParams connection credentials
   * @param options additional connection options; usually unnecessary
   */
  async connect(authParams: RtcAuthParams, options?: RtcOptions) {
    // this.delegate = this.createDelegateObject(authParams);

    if (this.streamAvailableHandler) {
      this.delegate!.onStreamAvailable(this.streamAvailableHandler);
    }

    if (this.streamUnavailableHandler) {
      this.delegate!.onStreamUnavailable(this.streamUnavailableHandler);
    }

    if (this.readyHandler) {
      this.delegate!.onReady(this.readyHandler);
    }

    return this.delegate!.connect(authParams, options);
  }

  /**
   * Set the log level for logs that will appear in the browser's console
   * Defaults to "warn"
   * @param logLevel log level
   */
  setLogLevel(logLevel: LogLevel) {
    this.logLevel = logLevel;
    logger.level = logLevel;
  }

  /**
   * Set the function that will be called when a subscribed stream becomes available
   * @param callback callback function
   */
  onStreamAvailable(callback: { (event: RtcStream): void }): void {
    this.streamAvailableHandler = callback;
    if (this.delegate) {
      this.delegate.onStreamAvailable(callback);
    }
  }

  /**
   * Set the function that will be called when a subscribed stream becomes unavailable
   * @param callback callback function
   */
  onStreamUnavailable(callback: { (event: RtcStream): void }): void {
    this.streamUnavailableHandler = callback;
    if (this.delegate) {
      this.delegate.onStreamUnavailable(callback);
    }
  }

  /**
   * Set the function that will be called when a subscribed stream becomes unavailable
   * @param callback callback function
   */
  onReady(callback: { (readyMetadata: ReadyMetadata): void }): void {
    this.readyHandler = callback;
    if (this.delegate) {
      this.delegate.onReady(callback);
    }
  }

  /**
   * Returns an array of available video input devices
   */
  getVideoInputs(): Promise<MediaDeviceInfo[]> {
    return this.getMediaDevices("videoinput");
  }

  /**
   * Enable/disable the camera (video tracks)
   * @param enabled whether video streams should be enabled
   * @param stream specific stream to operate on; optional, defaults to all streams
   */
  setCameraEnabled(enabled: boolean, stream?: RtcStream | string) {
    if (!this.delegate) {
      throw new BandwidthRtcError("You must call 'connect' before 'setCameraEnabled'");
    }

    // @ts-ignore
    return this.delegate.setCameraEnabled(enabled, stream);
  }

  /**
   * Publish media to the Bandwidth WebRTC platform
   *
   * This function can publish an existing MediaStream, or it can create and publish a new media stream from MediaStreamConstraints
   * @param input existing media or specific constraints to publish (optional, defaults to basic audio/video constraints)
   * @param audioLevelChangeHandler handler that can be called when the audio level of the published stream changes (optional)
   * @param alias stream alias/tag that will be included in subscription events and billing records, should not be PII (optional)
   * @param codecPreferences preferred audio and video codecs (optional, should almost never be needed)
   */
  async publish(
    input?: MediaStreamConstraints | MediaStream,
    audioLevelChangeHandler?: AudioLevelChangeHandler,
    alias?: string,
    codecPreferences?: CodecPreferences,
  ): Promise<RtcStream> {
    if (!this.delegate) {
      throw new BandwidthRtcError("You must call 'connect' before 'publish'");
    }

    return this.delegate.publish(input, audioLevelChangeHandler, alias, codecPreferences);
  }

  /**
   * Unpublish one or more streams.
   * @param streams streams to unpublish; leave empty to unpublish all streams
   */
  async unpublish(...streams: RtcStream[] | string[]) {
    if (!this.delegate) {
      throw new BandwidthRtcError("You must call 'connect' before 'unpublish'");
    }

    // @ts-ignore
    return this.delegate.unpublish(...streams);
  }

  /**
   * Returns an array of available audio input devices
   */
  getAudioInputs(): Promise<MediaDeviceInfo[]> {
    return this.getMediaDevices("audioinput");
  }

  /**
   * Returns an array of available audio output devices
   */
  getAudioOutputs(): Promise<MediaDeviceInfo[]> {
    return this.getMediaDevices("audiooutput");
  }

  /**
   * Returns an array of available media devices, optionally filtered by device kind
   * @param filter Device kind to filter on
   */
  async getMediaDevices(filter?: string): Promise<MediaDeviceInfo[]> {
    let devices = await navigator.mediaDevices.enumerateDevices();

    if (filter) {
      devices = devices.filter((device) => device.kind === filter);
    }

    return devices;
  }

  sendDtmf(tone: string, streamId?: string) {
    if (!this.delegate) {
      throw new BandwidthRtcError("You must call 'connect' before 'sendDtmf'");
    }

    return this.delegate.sendDtmf(tone, streamId);
  }

  /**
   * Enable/disable the mic (audio tracks)
   * @param enabled whether audio streams should be enabled
   * @param stream specific stream to operate on; optional, defaults to all streams
   */
  setMicEnabled(enabled: boolean, stream?: RtcStream | string) {
    if (!this.delegate) {
      throw new BandwidthRtcError("You must call 'connect' before 'setMicEnabled'");
    }

    // @ts-ignore
    return this.delegate.setMicEnabled(enabled, stream);
  }

  /**
   * Disconnect from the Bandwidth WebRTC platform, and tear down all published streams
   */
  disconnect() {
    if (!this.delegate) {
      throw new BandwidthRtcError("You must call 'connect' before 'disconnect'");
    }

    return this.delegate.disconnect();
  }

  requestOutboundConnection(id: string, type: EndpointType): Promise<OutboundConnectionResult> {
    if (!this.delegate) {
      throw new BandwidthRtcError("You must call 'connect' before 'requestOutboundConnection'");
    }
    return this.delegate.requestOutboundConnection(id, type);
  }

  hangupConnection(endpoint: string, type: EndpointType): Promise<HangupResult> {
    if (!this.delegate) {
      throw new BandwidthRtcError("You must call 'connect' before 'hangupConnection'");
    }
    return this.delegate.hangupConnection(endpoint, type);
  }

  acceptStream(callId?: string): Promise<void> {
    if (!this.delegate) {
      throw new BandwidthRtcError("You must call 'connect' before 'acceptStream'");
    }
    return this.delegate.acceptStream(callId);
  }

  declineStream(callId?: string): Promise<void> {
    if (!this.delegate) {
      throw new BandwidthRtcError("You must call 'connect' before 'declineStream'");
    }
    return this.delegate.declineStream(callId);
  }
}

interface JwtPayload {
  a?: string;
  p?: string;
  v?: string;
  exp?: string;
  tid?: string;
  iss?: string;
}

export default BandwidthRtc;
