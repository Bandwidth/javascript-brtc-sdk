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

  test("returns true when tones are queued on at least one sender", () => {
    const brtc = new BandwidthRtc();
    (brtc as any).localDtmfSenders.set("stream-1", makeDtmfSender());

    expect(brtc.sendDtmf("5")).toBe(true);
  });

  test("returns false without throwing when no senders are registered", () => {
    const brtc = new BandwidthRtc();
    expect(brtc.sendDtmf("5")).toBe(false);
  });

  test("returns false for an unknown streamId", () => {
    const brtc = new BandwidthRtc();
    const sender = makeDtmfSender();
    (brtc as any).localDtmfSenders.set("stream-1", sender);

    expect(brtc.sendDtmf("5", "nonexistent")).toBe(false);

    expect(sender.insertDTMF).not.toHaveBeenCalled();
  });

  test("skips a sender that is not ready (canInsertDTMF false) without throwing", () => {
    const brtc = new BandwidthRtc();
    const notReady = makeDtmfSender(false);
    const ready = makeDtmfSender(true);
    (brtc as any).localDtmfSenders.set("stream-1", notReady);
    (brtc as any).localDtmfSenders.set("stream-2", ready);

    expect(brtc.sendDtmf("5")).toBe(true);

    expect(notReady.insertDTMF).not.toHaveBeenCalled();
    expect(ready.insertDTMF).toHaveBeenCalledWith("5", 100, 70);
  });

  test("returns false when the only sender is not ready", () => {
    const brtc = new BandwidthRtc();
    (brtc as any).localDtmfSenders.set("stream-1", makeDtmfSender(false));

    expect(brtc.sendDtmf("5")).toBe(false);
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

    expect(brtc.sendDtmf("5")).toBe(true);

    expect(healthy.insertDTMF).toHaveBeenCalledWith("5", 100, 70);
  });
});

describe("bandwidthRtcV1 addStreamToPublishingPeerConnection", () => {
  afterEach(() => {
    delete (global as any).RTCRtpSender;
    delete (global as any).RTCRtpReceiver;
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

  test("appends telephone-event codec from receiver capabilities when missing from audio preferences", () => {
    const brtc = new BandwidthRtc();
    const transceiver = makeTransceiver();
    withPublishingPeerConnection(brtc, transceiver);

    const telephoneEventCodec = { mimeType: "audio/telephone-event", clockRate: 8000 };
    (global as any).RTCRtpReceiver = { getCapabilities: jest.fn().mockReturnValue({ codecs: [telephoneEventCodec] }) };

    const opusCodec = { mimeType: "audio/opus", clockRate: 48000 };
    (brtc as any).addStreamToPublishingPeerConnection(makeMockStream("stream-1", "audio"), { audio: [opusCodec] });

    expect(transceiver.setCodecPreferences).toHaveBeenCalledWith([opusCodec, telephoneEventCodec]);
  });

  test("falls back to sender capabilities for telephone-event when receiver capabilities lack it", () => {
    const brtc = new BandwidthRtc();
    const transceiver = makeTransceiver();
    withPublishingPeerConnection(brtc, transceiver);

    const telephoneEventCodec = { mimeType: "audio/telephone-event", clockRate: 8000 };
    (global as any).RTCRtpReceiver = { getCapabilities: jest.fn().mockReturnValue({ codecs: [] }) };
    (global as any).RTCRtpSender = { getCapabilities: jest.fn().mockReturnValue({ codecs: [telephoneEventCodec] }) };

    const opusCodec = { mimeType: "audio/opus", clockRate: 48000 };
    (brtc as any).addStreamToPublishingPeerConnection(makeMockStream("stream-1", "audio"), { audio: [opusCodec] });

    expect(transceiver.setCodecPreferences).toHaveBeenCalledWith([opusCodec, telephoneEventCodec]);
  });

  test("does not duplicate telephone-event when already in preferences", () => {
    const brtc = new BandwidthRtc();
    const transceiver = makeTransceiver();
    withPublishingPeerConnection(brtc, transceiver);

    const opusCodec = { mimeType: "audio/opus", clockRate: 48000 };
    const telephoneEventCodec = { mimeType: "audio/telephone-event", clockRate: 8000 };
    (brtc as any).addStreamToPublishingPeerConnection(makeMockStream("stream-1", "audio"), { audio: [opusCodec, telephoneEventCodec] });

    expect(transceiver.setCodecPreferences).toHaveBeenCalledWith([opusCodec, telephoneEventCodec]);
    expect(transceiver.setCodecPreferences).toHaveBeenCalledTimes(1);
  });

  test("falls back to original preferences when telephone-event not found in capabilities", () => {
    const brtc = new BandwidthRtc();
    const transceiver = makeTransceiver();
    withPublishingPeerConnection(brtc, transceiver);

    (global as any).RTCRtpSender = { getCapabilities: jest.fn().mockReturnValue({ codecs: [] }) };
    (global as any).RTCRtpReceiver = { getCapabilities: jest.fn().mockReturnValue({ codecs: [] }) };

    const opusCodec = { mimeType: "audio/opus", clockRate: 48000 };
    (brtc as any).addStreamToPublishingPeerConnection(makeMockStream("stream-1", "audio"), { audio: [opusCodec] });

    expect(transceiver.setCodecPreferences).toHaveBeenCalledWith([opusCodec]);
  });

  test("does not call setCodecPreferences when no codecPreferences are provided", () => {
    const brtc = new BandwidthRtc();
    const transceiver = makeTransceiver();
    withPublishingPeerConnection(brtc, transceiver);

    const opusCodec = { mimeType: "audio/opus", clockRate: 48000 };
    const telephoneEventCodec = { mimeType: "audio/telephone-event", clockRate: 8000 };
    (global as any).RTCRtpSender = { getCapabilities: jest.fn().mockReturnValue({ codecs: [opusCodec, telephoneEventCodec] }) };
    (global as any).RTCRtpReceiver = { getCapabilities: jest.fn().mockReturnValue({ codecs: [opusCodec, telephoneEventCodec] }) };

    (brtc as any).addStreamToPublishingPeerConnection(makeMockStream("stream-1", "audio"));

    expect(transceiver.setCodecPreferences).not.toHaveBeenCalled();
  });

  test("applies audio preferences as-is when capability APIs are unavailable (e.g. non-browser environment)", () => {
    const brtc = new BandwidthRtc();
    const transceiver = makeTransceiver();
    withPublishingPeerConnection(brtc, transceiver);

    const opusCodec = { mimeType: "audio/opus", clockRate: 48000 };
    expect(() => (brtc as any).addStreamToPublishingPeerConnection(makeMockStream("stream-1", "audio"), { audio: [opusCodec] })).not.toThrow();

    expect(transceiver.setCodecPreferences).toHaveBeenCalledWith([opusCodec]);
  });

  test("retries with the caller's preferences when the telephone-event-augmented list is rejected", () => {
    const brtc = new BandwidthRtc();
    const transceiver = makeTransceiver();
    withPublishingPeerConnection(brtc, transceiver);

    const telephoneEventCodec = { mimeType: "audio/telephone-event", clockRate: 8000 };
    (global as any).RTCRtpReceiver = { getCapabilities: jest.fn().mockReturnValue({ codecs: [telephoneEventCodec] }) };

    transceiver.setCodecPreferences.mockImplementationOnce(() => {
      throw new DOMException("RTCRtpCodec sdpFmtLine badly formated", "InvalidModificationError");
    });

    const opusCodec = { mimeType: "audio/opus", clockRate: 48000 };
    expect(() => (brtc as any).addStreamToPublishingPeerConnection(makeMockStream("stream-1", "audio"), { audio: [opusCodec] })).not.toThrow();

    expect(transceiver.setCodecPreferences).toHaveBeenNthCalledWith(1, [opusCodec, telephoneEventCodec]);
    expect(transceiver.setCodecPreferences).toHaveBeenNthCalledWith(2, [opusCodec]);
  });

  test("falls back to browser default codecs without throwing when setCodecPreferences always rejects", () => {
    const brtc = new BandwidthRtc();
    const transceiver = makeTransceiver();
    withPublishingPeerConnection(brtc, transceiver);

    const telephoneEventCodec = { mimeType: "audio/telephone-event", clockRate: 8000 };
    (global as any).RTCRtpReceiver = { getCapabilities: jest.fn().mockReturnValue({ codecs: [telephoneEventCodec] }) };

    transceiver.setCodecPreferences.mockImplementation(() => {
      throw new DOMException("codecs do not match capabilities", "InvalidModificationError");
    });

    const opusCodec = { mimeType: "audio/opus", clockRate: 48000 };
    expect(() => (brtc as any).addStreamToPublishingPeerConnection(makeMockStream("stream-1", "audio"), { audio: [opusCodec] })).not.toThrow();

    expect(transceiver.setCodecPreferences).toHaveBeenCalledTimes(2);
  });

  test("does not throw when video codec preferences are rejected", () => {
    const brtc = new BandwidthRtc();
    const transceiver = makeTransceiver();
    withPublishingPeerConnection(brtc, transceiver);

    transceiver.setCodecPreferences.mockImplementation(() => {
      throw new DOMException("codecs do not match capabilities", "InvalidModificationError");
    });

    const vp8Codec = { mimeType: "video/VP8", clockRate: 90000 };
    expect(() => (brtc as any).addStreamToPublishingPeerConnection(makeMockStream("stream-1", "video"), { video: [vp8Codec] })).not.toThrow();

    expect(transceiver.setCodecPreferences).toHaveBeenCalledWith([vp8Codec]);
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
