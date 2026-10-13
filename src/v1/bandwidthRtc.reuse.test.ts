// Real BandwidthRtc and Signaling; only the JSON-RPC websocket client and RTCPeerConnection are faked.
// Reusing one instance for several connect()/disconnect() cycles must behave like the first cycle.
const gateway = {
  clients: [] as any[],
  pendingAnswer: { publish: false, subscribe: false } as Record<string, boolean>,
  rejectedAnswers: 0,
};

jest.mock("./rpcClient", () => {
  const { EventEmitter } = require("events");
  class RpcTimeoutError extends Error {}
  class RpcClient extends EventEmitter {
    ready = true;
    socket = {};
    constructor() {
      super();
      gateway.clients.push(this);
    }
    setAutoReconnect() {}
    close() {
      this.ready = false;
    }
    notify() {
      return Promise.resolve();
    }
    call(method: string, params: any): Promise<any> {
      if (method === "setMediaPreferences") {
        gateway.pendingAnswer.publish = true;
        gateway.pendingAnswer.subscribe = true;
        return Promise.resolve({
          publishSdpOffer: { sdpOffer: "v=0 publish-offer" },
          subscribeSdpOffer: { sdpOffer: "v=0 subscribe-offer" },
        });
      }
      if (method === "answerSdp") {
        // Like the gateway, accept an answer only while an offer is waiting for one
        if (gateway.pendingAnswer[params.peerType]) {
          gateway.pendingAnswer[params.peerType] = false;
          return Promise.resolve({});
        }
        gateway.rejectedAnswers++;
        return Promise.reject(new Error("invalid proposed signaling state transition: stable->SetRemote(answer)->stable"));
      }
      return Promise.resolve({});
    }
  }
  return { RpcClient, RpcTimeoutError, DEFAULT_CALL_TIMEOUT_MS: 45000 };
});

import { BandwidthRtc } from "./bandwidthRtc";
import WrapperBandwidthRtc from "../bandwidthRtc";

const peerConnections: any[] = [];
class FakePeerConnection {
  closed = false;
  connectionState = "connected";
  constructor() {
    peerConnections.push(this);
  }
  close() {
    this.closed = true;
    this.connectionState = "closed";
  }
  async setRemoteDescription() {}
  async setLocalDescription() {}
  async createAnswer() {
    return { type: "answer", sdp: "v=0 answer" };
  }
  async createOffer() {
    return { type: "offer", sdp: "v=0 offer" };
  }
  addTransceiver() {
    return { sender: { dtmf: null } };
  }
  getTransceivers() {
    return [];
  }
}
(global as any).RTCPeerConnection = FakePeerConnection;

const LISTENED_EVENTS = ["ready", "sdpOffer", "init", "fatalError"];
const CYCLES = 3;

const flush = async () => {
  for (let i = 0; i < 20; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
};

describe("bandwidthRtcV1 reused across connect/disconnect cycles", () => {
  let initRuns: number;
  let initFailures: any[];

  beforeEach(() => {
    gateway.clients.length = 0;
    gateway.rejectedAnswers = 0;
    peerConnections.length = 0;
    initRuns = 0;
    initFailures = [];
    jest.spyOn(console, "log").mockImplementation(() => {});

    // Installed before the instance is built: the handlers are bound to init when it is constructed
    const init = BandwidthRtc.prototype.init;
    jest.spyOn(BandwidthRtc.prototype, "init").mockImplementation(function (this: BandwidthRtc, ...args) {
      initRuns++;
      const run = init.apply(this, args);
      run.catch((err) => initFailures.push(err));
      return run;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // Drives one session through open -> ready and returns the gateway-side websocket
  async function connect(client: { connect: (auth: { endpointToken: string }) => Promise<void> }) {
    const connecting = client.connect({ endpointToken: "token" });
    const ws = gateway.clients[gateway.clients.length - 1];
    ws.emit("open");
    await flush();
    ws.emit("ready", {});
    await connecting;
    await flush();
    return ws;
  }

  test("keeps exactly one listener per event across cycles", async () => {
    const brtc = new BandwidthRtc();
    const signaling = (brtc as any).signaling;

    for (let cycle = 1; cycle <= CYCLES; cycle++) {
      await connect(brtc);
      expect(LISTENED_EVENTS.map((event) => signaling.listenerCount(event))).toEqual([1, 1, 1, 1]);
      brtc.disconnect();
      expect(LISTENED_EVENTS.map((event) => signaling.listenerCount(event))).toEqual([1, 1, 1, 1]);
    }
  });

  test("runs init once per connect and leaves the publishing peer connection open", async () => {
    const brtc = new BandwidthRtc();

    for (let cycle = 1; cycle <= CYCLES; cycle++) {
      initRuns = 0;
      await connect(brtc);

      expect(initRuns).toBe(1);
      expect(initFailures).toEqual([]);
      expect(gateway.rejectedAnswers).toBe(0);
      expect((brtc as any).publishingPeerConnection.closed).toBe(false);
      expect((brtc as any).subscribingPeerConnection.closed).toBe(false);
      brtc.disconnect();
    }
  });

  test("fires onReady and onError once per event on every cycle", async () => {
    const brtc = new BandwidthRtc();
    const onReady = jest.fn();
    const onError = jest.fn();
    brtc.onReady(onReady);
    brtc.onError(onError);

    for (let cycle = 1; cycle <= CYCLES; cycle++) {
      onReady.mockClear();
      onError.mockClear();
      await connect(brtc);
      expect(onReady).toHaveBeenCalledTimes(1);

      (brtc as any).signaling.emit("fatalError", new Error("boom"));
      expect(onError).toHaveBeenCalledTimes(1);
      brtc.disconnect();
    }
  });

  test("the default export reused for several calls behaves like the first call", async () => {
    const wrapper = new WrapperBandwidthRtc();
    const onReady = jest.fn();
    wrapper.onReady(onReady);

    for (let cycle = 1; cycle <= CYCLES; cycle++) {
      onReady.mockClear();
      initRuns = 0;
      await connect(wrapper);

      expect(onReady).toHaveBeenCalledTimes(1);
      expect(initRuns).toBe(1);
      expect(gateway.rejectedAnswers).toBe(0);
      wrapper.disconnect();
    }
  });
});
