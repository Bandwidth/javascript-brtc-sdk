import { BandwidthRtc } from "./bandwidthRtc";
import { setupMocks, setupNavigatorMocks } from "../mocks";

// Mock Signaling class
jest.mock("./signaling", () => {
  return jest.fn().mockImplementation(() => ({
    on: jest.fn(),
    connect: jest.fn().mockResolvedValue(undefined),
    disconnect: jest.fn(),
  }));
});

// Mock DiagnosticsBatcher
jest.mock("./diagnostics", () => ({
  DiagnosticsBatcher: jest.fn().mockImplementation(() => ({
    on: jest.fn(),
    flushDiagnostics: jest.fn(),
  })),
}));

describe("bandwidhthRtcV1 constructor", () => {
  beforeAll(() => {
    setupNavigatorMocks();
    setupMocks();
  });

  test("should create instance without error", () => {
    const bandwidthRtc = new BandwidthRtc("debug");
    expect(bandwidthRtc).toBeDefined();
    expect(bandwidthRtc).toBeInstanceOf(BandwidthRtc);
  });

  test("should initialize DiagnosticsBatcher and Signaling in constructor", () => {
    const bandwidthRtc = new BandwidthRtc("debug");

    // Verify the instance was created
    expect(bandwidthRtc).toBeDefined();

    // Access private properties via reflection to verify they were initialized
    const privateBandwidthRtc = bandwidthRtc as any;
    expect(privateBandwidthRtc.diagnosticsBatcher).toBeDefined();
    expect(privateBandwidthRtc.signaling).toBeDefined();
  });

  test("should bind methods in constructor", () => {
    const bandwidthRtc = new BandwidthRtc("debug");

    // Verify methods are callable (bound correctly)
    expect(typeof bandwidthRtc.setMicEnabled).toBe("function");
    expect(typeof bandwidthRtc.setCameraEnabled).toBe("function");

    // Access private method via reflection
    const privateBandwidthRtc = bandwidthRtc as any;
    expect(typeof privateBandwidthRtc.setupNewPeerConnection).toBe("function");
  });
});

describe("bandwidthRtcV1 sendDtmf", () => {
  beforeAll(() => {
    setupNavigatorMocks();
    setupMocks();
  });

  function makeDtmfSender(canInsertDTMF: boolean = true) {
    return { insertDTMF: jest.fn(), canInsertDTMF };
  }

  test("calls insertDTMF on all registered senders when no streamId given", () => {
    const brtc = new BandwidthRtc();
    const sender1 = makeDtmfSender();
    const sender2 = makeDtmfSender();
    (brtc as any).localDtmfSenders.set("stream-1", sender1);
    (brtc as any).localDtmfSenders.set("stream-2", sender2);

    brtc.sendDtmf("5");

    expect(sender1.insertDTMF).toHaveBeenCalledTimes(1);
    expect(sender1.insertDTMF).toHaveBeenCalledWith("5", 100, 70);
    expect(sender2.insertDTMF).toHaveBeenCalledTimes(1);
    expect(sender2.insertDTMF).toHaveBeenCalledWith("5", 100, 70);
  });

  test("calls insertDTMF only on the specified stream when streamId given", () => {
    const brtc = new BandwidthRtc();
    const sender1 = makeDtmfSender();
    const sender2 = makeDtmfSender();
    (brtc as any).localDtmfSenders.set("stream-1", sender1);
    (brtc as any).localDtmfSenders.set("stream-2", sender2);

    brtc.sendDtmf("9", "stream-1");

    expect(sender1.insertDTMF).toHaveBeenCalledTimes(1);
    expect(sender2.insertDTMF).not.toHaveBeenCalled();
  });

  test("forwards duration and interToneGap to insertDTMF", () => {
    const brtc = new BandwidthRtc();
    const sender = makeDtmfSender();
    (brtc as any).localDtmfSenders.set("stream-1", sender);

    brtc.sendDtmf("1", undefined, 200, 80);

    expect(sender.insertDTMF).toHaveBeenCalledWith("1", 200, 80);
  });

  test("does not throw when no senders are registered", () => {
    const brtc = new BandwidthRtc();
    expect(() => brtc.sendDtmf("5")).not.toThrow();
  });

  test("does nothing for an unknown streamId", () => {
    const brtc = new BandwidthRtc();
    const sender = makeDtmfSender();
    (brtc as any).localDtmfSenders.set("stream-1", sender);

    brtc.sendDtmf("5", "nonexistent");

    expect(sender.insertDTMF).not.toHaveBeenCalled();
  });

  test("skips a sender that is not ready (canInsertDTMF false) without throwing", () => {
    const brtc = new BandwidthRtc();
    const notReady = makeDtmfSender(false);
    const ready = makeDtmfSender(true);
    (brtc as any).localDtmfSenders.set("stream-1", notReady);
    (brtc as any).localDtmfSenders.set("stream-2", ready);

    expect(() => brtc.sendDtmf("5")).not.toThrow();

    expect(notReady.insertDTMF).not.toHaveBeenCalled();
    expect(ready.insertDTMF).toHaveBeenCalledWith("5", 100, 70);
  });

  test("catches an insertDTMF error on one sender and still calls the others", () => {
    const brtc = new BandwidthRtc();
    const throwing = makeDtmfSender();
    throwing.insertDTMF.mockImplementation(() => {
      throw new DOMException("not ready", "InvalidStateError");
    });
    const healthy = makeDtmfSender();
    (brtc as any).localDtmfSenders.set("stream-1", throwing);
    (brtc as any).localDtmfSenders.set("stream-2", healthy);

    expect(() => brtc.sendDtmf("5")).not.toThrow();

    expect(healthy.insertDTMF).toHaveBeenCalledWith("5", 100, 70);
  });
});

describe("bandwidthRtcV1 addStreamToPublishingPeerConnection", () => {
  afterEach(() => {
    delete (global as any).RTCRtpSender;
  });

  function makeTransceiver(dtmf: RTCDTMFSender | null = { insertDTMF: jest.fn() } as any) {
    return { sender: { dtmf }, setCodecPreferences: jest.fn() };
  }

  function makeMockStream(id: string, trackKind: string) {
    return { id, getTracks: () => [{ kind: trackKind, id: "track-1" }] };
  }

  function withPublishingPeerConnection(brtc: BandwidthRtc, transceiver: ReturnType<typeof makeTransceiver>) {
    (brtc as any).publishingPeerConnection = { addTransceiver: jest.fn().mockReturnValue(transceiver) };
  }

  test("stores dtmf sender for audio track", () => {
    const brtc = new BandwidthRtc();
    const dtmfSender = { insertDTMF: jest.fn() };
    const transceiver = makeTransceiver(dtmfSender as any);
    withPublishingPeerConnection(brtc, transceiver);

    (brtc as any).addStreamToPublishingPeerConnection(makeMockStream("stream-1", "audio"));

    expect((brtc as any).localDtmfSenders.get("stream-1")).toBe(dtmfSender);
  });

  test("does not store dtmf sender when sender.dtmf is null", () => {
    const brtc = new BandwidthRtc();
    withPublishingPeerConnection(brtc, makeTransceiver(null));

    (brtc as any).addStreamToPublishingPeerConnection(makeMockStream("stream-1", "audio"));

    expect((brtc as any).localDtmfSenders.has("stream-1")).toBe(false);
  });

  test("appends the clock-matched telephone-event when missing from audio preferences", () => {
    const brtc = new BandwidthRtc();
    const transceiver = makeTransceiver();
    withPublishingPeerConnection(brtc, transceiver);

    const te8000 = { mimeType: "audio/telephone-event", clockRate: 8000 };
    const te48000 = { mimeType: "audio/telephone-event", clockRate: 48000 };
    (global as any).RTCRtpSender = { getCapabilities: jest.fn().mockReturnValue({ codecs: [te8000, te48000] }) };

    const opusCodec = { mimeType: "audio/opus", clockRate: 48000 };
    (brtc as any).addStreamToPublishingPeerConnection(makeMockStream("stream-1", "audio"), { audio: [opusCodec] });

    // Must pair with telephone-event/48000 (Opus clock), not the 8000 variant.
    expect(transceiver.setCodecPreferences).toHaveBeenCalledWith([opusCodec, te48000]);
  });

  test("replaces a clock-mismatched telephone-event already in preferences", () => {
    const brtc = new BandwidthRtc();
    const transceiver = makeTransceiver();
    withPublishingPeerConnection(brtc, transceiver);

    const opusCodec = { mimeType: "audio/opus", clockRate: 48000 };
    const te8000 = { mimeType: "audio/telephone-event", clockRate: 8000 };
    const te48000 = { mimeType: "audio/telephone-event", clockRate: 48000 };
    (global as any).RTCRtpSender = { getCapabilities: jest.fn().mockReturnValue({ codecs: [te48000] }) };

    (brtc as any).addStreamToPublishingPeerConnection(makeMockStream("stream-1", "audio"), { audio: [opusCodec, te8000] });

    // The mismatched 8000 event is dropped and replaced with the 48000 one from capabilities.
    expect(transceiver.setCodecPreferences).toHaveBeenCalledWith([opusCodec, te48000]);
    expect(transceiver.setCodecPreferences).toHaveBeenCalledTimes(1);
  });

  test("keeps the clock-matched telephone-event already in preferences", () => {
    const brtc = new BandwidthRtc();
    const transceiver = makeTransceiver();
    withPublishingPeerConnection(brtc, transceiver);

    const opusCodec = { mimeType: "audio/opus", clockRate: 48000 };
    const te48000 = { mimeType: "audio/telephone-event", clockRate: 48000 };
    (brtc as any).addStreamToPublishingPeerConnection(makeMockStream("stream-1", "audio"), { audio: [opusCodec, te48000] });

    expect(transceiver.setCodecPreferences).toHaveBeenCalledWith([opusCodec, te48000]);
    expect(transceiver.setCodecPreferences).toHaveBeenCalledTimes(1);
  });

  test("falls back to original preferences when no clock-matched telephone-event is available", () => {
    const brtc = new BandwidthRtc();
    const transceiver = makeTransceiver();
    withPublishingPeerConnection(brtc, transceiver);

    // Only a mismatched (8000) telephone-event exists; better to omit it than offer a dropped codec.
    const te8000 = { mimeType: "audio/telephone-event", clockRate: 8000 };
    (global as any).RTCRtpSender = { getCapabilities: jest.fn().mockReturnValue({ codecs: [te8000] }) };

    const opusCodec = { mimeType: "audio/opus", clockRate: 48000 };
    (brtc as any).addStreamToPublishingPeerConnection(makeMockStream("stream-1", "audio"), { audio: [opusCodec] });

    expect(transceiver.setCodecPreferences).toHaveBeenCalledWith([opusCodec]);
  });

  test("forces the clock-matched telephone-event even without explicit codecPreferences", () => {
    const brtc = new BandwidthRtc();
    const transceiver = makeTransceiver();
    withPublishingPeerConnection(brtc, transceiver);

    const opusCodec = { mimeType: "audio/opus", clockRate: 48000 };
    const te8000 = { mimeType: "audio/telephone-event", clockRate: 8000 };
    const te48000 = { mimeType: "audio/telephone-event", clockRate: 48000 };
    (global as any).RTCRtpSender = { getCapabilities: jest.fn().mockReturnValue({ codecs: [opusCodec, te8000, te48000] }) };

    (brtc as any).addStreamToPublishingPeerConnection(makeMockStream("stream-1", "audio"));

    // Full capabilities collapse to the primary codec + its matching-clock telephone-event.
    expect(transceiver.setCodecPreferences).toHaveBeenCalledWith([opusCodec, te48000]);
  });

  test("skips setCodecPreferences when RTCRtpSender is unavailable (e.g. non-browser environment)", () => {
    const brtc = new BandwidthRtc();
    const transceiver = makeTransceiver();
    withPublishingPeerConnection(brtc, transceiver);

    expect(() => (brtc as any).addStreamToPublishingPeerConnection(makeMockStream("stream-1", "audio"))).not.toThrow();

    expect(transceiver.setCodecPreferences).not.toHaveBeenCalled();
  });
});

describe("bandwidthRtcV1 connect method", () => {
  beforeAll(() => {
    setupNavigatorMocks();
    setupMocks();
  });

  test("should connect without error", async () => {
    const bandwidthRtc = new BandwidthRtc("debug");

    await expect(
      bandwidthRtc.connect({
        endpointToken: "test-token",
      }),
    ).resolves.not.toThrow();
  });

  test("should set up event listeners after connecting", async () => {
    const bandwidthRtc = new BandwidthRtc("debug");

    await bandwidthRtc.connect({
      endpointToken: "test-token",
    });

    // Access private signaling property via reflection
    const privateBandwidthRtc = bandwidthRtc as any;
    const signaling = privateBandwidthRtc.signaling;
    expect(signaling.on).toHaveBeenCalledWith("ready", expect.any(Function));
    expect(signaling.on).toHaveBeenCalledWith("sdpOffer", expect.any(Function));
    expect(signaling.on).toHaveBeenCalledWith("init", expect.any(Function));
  });
});
