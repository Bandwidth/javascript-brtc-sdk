const sdkVersion = require("../../package.json").version;
import { v4 as uuid } from "uuid";
import { EventEmitter } from "events";
import { Client as JsonRpcClient } from "rpc-websockets";
import logger from "../logging";
import { EndpointType, HangupResult, OutboundConnectionResult, RtcAuthParams, RtcOptions } from "../types";
import { PublishSdpAnswer, PublishMetadata, ReadyMetadata, SetMediaPreferencesWebRtcResponse, SdpAnswer } from "./types";
import { Diagnostics, DiagnosticsBatcher } from "./diagnostics";

/**
 * Handshake failures that will keep recurring for as long as the underlying
 * condition holds, keyed by the `ws` error message for a non-101 response.
 *
 * The client is built with unlimited auto-reconnect, so without this the SDK
 * retries these forever — several times a second against a gateway that is
 * telling it, correctly, that the connection cannot be established. Reconnect
 * is disabled and the error surfaced instead, leaving retry policy to the app.
 *
 * Note this only works under Node: browsers do not expose the HTTP status of a
 * failed websocket upgrade to the error handler.
 */
const FATAL_HANDSHAKE_ERRORS: Record<string, { status: number; logMessage: string; error: string }> = {
  "Unexpected server response: 403": {
    status: 403,
    logMessage: "Authentication error: Invalid token",
    error: "Invalid token",
  },
  "Unexpected server response: 409": {
    status: 409,
    logMessage: "Endpoint already has an active connection from a different device",
    error: "Endpoint already has an active connection",
  },
};

/**
 * Close codes that should trigger a reconnect on this same client instance.
 * Every other code, including ones this SDK doesn't recognize, tears the
 * connection down instead of retrying it.
 */
const RETRY_CLOSE_CODES = new Set([1001]);

class Signaling extends EventEmitter {
  private defaultWebsocketUrl: string = "wss://gateway.pv.prod.global.aws.bandwidth.com/prod/gateway-service/api/v1/endpoints";
  private ws: JsonRpcClient | null = null;
  private pingInterval?: NodeJS.Timeout;
  private uniqueDeviceId: string = uuid();
  private isReady: boolean = false;
  private readyMetadata: ReadyMetadata | null = null;
  private diagnosticsBatcher?: DiagnosticsBatcher;
  private rtcOptions?: RtcOptions;

  constructor(diagnosticsBatcher?: DiagnosticsBatcher) {
    super();
    if (diagnosticsBatcher) {
      this.diagnosticsBatcher = diagnosticsBatcher;
      this.diagnosticsBatcher.on("diagnostics", this.sendDiagnostics.bind(this));
    }
  }

  connect(authParams: RtcAuthParams, options?: RtcOptions) {
    let rpc_id = 1;
    // rpc-websockets auto-reconnects with a brand new underlying WebSocket (same
    // JsonRpcClient instance), so "open" fires again on every reconnect. Scoped to
    // this connect() call so a fresh top-level connect() always starts as false.
    let hasConnectedOnce = false;

    return new Promise<void>((resolve, reject) => {
      if (this.ws) {
        // A prior connect() left a client behind. Tear it down before replacing
        // this.ws — otherwise the old client's unlimited auto-reconnect keeps
        // running in the background forever. Its "open" handler calls
        // setMediaPreferences() via this.ws, which by then points at the new
        // client, so the orphaned socket never sends anything on its own
        // connection and just sits idle until the gateway reaps it.
        this._disconnect(false);
      }

      let rtcOptions: RtcOptions = {
        websocketUrl: this.defaultWebsocketUrl,
      };

      if (options) {
        rtcOptions = { ...rtcOptions, ...options };
      }
      this.rtcOptions = rtcOptions;
      const websocketUrl = `${rtcOptions.websocketUrl}?client=node&sdkVersion=${sdkVersion}&uniqueId=${this.uniqueDeviceId}&endpointToken=${authParams.endpointToken}`;
      logger.debug(`Connecting to ${websocketUrl}`);
      console.log(`Connecting to ${websocketUrl}`);

      const ws = new JsonRpcClient(websocketUrl, {
        autoconnect: true,
        reconnect: true,
        max_reconnects: 0, // Unlimited
      });

      logger.debug(`Connected to ${websocketUrl}`);
      this.ws = ws;

      ws.on("sdpOffer", (event: any) => {
        this.emit("sdpOffer", event);
      });

      ws.on("established", (event: any) => {
        this.emit("established", event);
      });

      ws.on("open", async () => {
        logger.debug("Websocket open");
        const isReconnect = hasConnectedOnce;
        hasConnectedOnce = true;
        if (!isReconnect && globalThis.addEventListener) {
          globalThis.addEventListener("beforeunload", (event) => {
            this.disconnect();
          });
        }
        let preferencesResponse = await this.setMediaPreferences();
        // logger.debug(`Media preferences set`, preferencesResponse);
        // Setup Peers. isReconnect tells the caller whether existing peer connections/media
        // need to be rebuilt and re-published, rather than created for the first time.
        this.emit("init", preferencesResponse, isReconnect);

        this.pingInterval = setInterval(() => {
          ws.call("ping", {});
        }, 60000);
        logger.debug("Websocket configured");
      });

      ws.on("ready", async (readyMetadata: ReadyMetadata) => {
        logger.debug("Websocket ready", readyMetadata);
        this.isReady = true;
        this.readyMetadata = readyMetadata;
        this.emit("ready", readyMetadata);
        resolve();
      });

      ws.on("error", (error: ErrorEvent) => {
        const fatal = FATAL_HANDSHAKE_ERRORS[error.message];
        if (fatal) {
          logger.error(fatal.logMessage);
          ws.close(fatal.status);
          ws.setAutoReconnect(false);
          reject(new Error(fatal.error));
          // Disconnect without calling leave since we are not connected
          this._disconnect(false);
          return;
        }
        // TODO: make this a more informative error message
        logger.error(`Websocket error: ${error.message}`);
        if (this.pingInterval) {
          clearInterval(this.pingInterval);
        }
      });

      ws.on("close", (code: number) => {
        logger.debug(`Websocket closed: ${code}`);
        if (this.pingInterval) {
          clearInterval(this.pingInterval);
        }
        if (!RETRY_CLOSE_CODES.has(code)) {
          // rpc-websockets schedules its own reconnect synchronously, before it
          // fires the "close" event we're handling here, so setAutoReconnect(false)
          // alone is too late — the pending timer has to be cleared directly.
          clearTimeout((ws as any).reconnect_timer_id);
          ws.setAutoReconnect(false);
          this._disconnect(false);
        }
        this.isReady = false;
      });
    });
  }

  private setMediaPreferences(): Promise<{}> {
    const autoAccept = this.rtcOptions?.autoAccept ?? true;
    logger.debug(`Calling "setMediaPreferences"`, { protocol: "WEBRTC", autoAccept });
    return this.ws?.call("setMediaPreferences", {
      protocol: "WEBRTC",
      autoAccept,
    }) as Promise<SetMediaPreferencesWebRtcResponse>;
  }

  private _disconnect(notifyLeave: boolean) {
    logger.debug("Disconnecting websocket");
    if (this.ws) {
      if (notifyLeave) {
        try {
          this.ws.notify("leave");
        } catch (err) {
          logger.error("Error calling `leave`", err);
        }
      }
      if (this.diagnosticsBatcher) {
        try {
          this.diagnosticsBatcher.shutdown();
          const finalDiagnostics = this.diagnosticsBatcher.getDiagnostics();
          this.sendDiagnostics(finalDiagnostics);
        } catch (err) {
          logger.error("Error sending diagnostics... websocket may be disconnected", err);
        }
      }
      // Stop auto-reconnect BEFORE closing. The client is constructed with
      // `reconnect: true, max_reconnects: 0` (unlimited), and rpc-websockets
      // only skips reconnecting when the close code is exactly 1000 — so any
      // other code (notably 1001/StatusGoingAway, which the gateway sends
      // whenever it wants the device to come back) puts the client into an
      // endless reconnect loop. That loop outlives this disconnect: because
      // removeAllListeners() has already run, the reconnected socket has no
      // "open" handler, so it never calls setMediaPreferences, never creates
      // peer connections, and never answers the heartbeat — an inert
      // connection on the gateway that nothing on either side reaps.
      //
      // Reconnect stays enabled for the lifetime of a live connection (that is
      // the point of it); it is only disabled here, where the caller has asked
      // to disconnect and we are tearing this client down for good.
      try {
        this.ws.setAutoReconnect(false);
      } catch (err) {
        logger.error("Error disabling auto-reconnect", err);
      }
      this.ws.removeAllListeners();
      try {
        this.ws.close();
      } catch (err) {
        logger.error(err);
      }
      this.ws = null;
    }
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
    }
    this.isReady = false;
  }

  disconnect() {
    this._disconnect(true);
  }

  requestOutboundConnection(id: string, type: EndpointType): Promise<OutboundConnectionResult> {
    logger.debug(`Calling "requestOutboundConnection"`, { id: id, type: type });
    return this.ws?.call("requestOutboundConnection", {
      id: id,
      type: type,
    }) as Promise<OutboundConnectionResult>;
  }

  hangupConnection(endpoint: string, type: EndpointType): Promise<HangupResult> {
    logger.debug(`Calling "hangupConnection"`, { endpoint: endpoint, type: type });
    return this.ws?.call("hangupConnection", {
      endpoint: endpoint,
      type: type,
    }) as Promise<HangupResult>;
  }

  acceptStream(): Promise<void> {
    logger.debug(`Calling "acceptStream"`);
    return this.ws?.call("acceptStream", {}) as Promise<void>;
  }

  declineStream(): Promise<void> {
    logger.debug(`Calling "declineStream"`);
    return this.ws?.call("declineStream", {}) as Promise<void>;
  }

  offerSdp(peerType: string, sdpOffer: string): Promise<SdpAnswer> {
    logger.debug(`Calling "offerSdp"`, { sdpOffer: sdpOffer, peerType: peerType });
    return this.ws?.call("offerSdp", { sdpOffer: sdpOffer, peerType: peerType }) as Promise<SdpAnswer>;
  }

  answerSdp(sdpAnswer: string, peerType: string): Promise<void> {
    logger.debug(`Calling "answerSdp"`, { sdpAnswer: sdpAnswer });
    return this.ws?.call("answerSdp", {
      peerType: peerType,
      sdpAnswer: sdpAnswer,
    }) as Promise<void>;
  }

  private sendDiagnostics(diagnostics: Diagnostics): Promise<void> {
    logger.debug(`Calling "deviceDiagnostics"`);
    return this.ws?.notify("deviceDiagnostics", diagnostics).catch((err: any) => {
      logger.error("Error sending diagnostics", err);
    }) as Promise<void>;
  }
}

export default Signaling;
