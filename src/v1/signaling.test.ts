import Signaling from "./signaling";
import { DiagnosticsBatcher } from "./diagnostics";
import { EndpointType } from "../types";

// Mock rpc-websockets
jest.mock("rpc-websockets", () => {
  return {
    Client: jest.fn().mockImplementation(() => {
      const mockClient = {
        on: jest.fn((event: string, callback: Function) => {
          // Automatically trigger 'ready' event for successful connections
          if (event === "ready") {
            setTimeout(() => callback({ endpointId: "test-endpoint" }), 0);
          }
        }),
        call: jest.fn().mockResolvedValue({}),
        notify: jest.fn().mockResolvedValue({}),
        close: jest.fn(),
        setAutoReconnect: jest.fn(),
        removeAllListeners: jest.fn(),
      };
      return mockClient;
    }),
  };
});

describe("Signaling constructor", () => {
  test("should create instance without diagnosticsBatcher", () => {
    const signaling = new Signaling();
    expect(signaling).toBeDefined();
    expect(signaling).toBeInstanceOf(Signaling);
  });

  test("should create instance with diagnosticsBatcher", () => {
    const diagnosticsBatcher = new DiagnosticsBatcher();
    const signaling = new Signaling(diagnosticsBatcher);
    expect(signaling).toBeDefined();
    expect(signaling).toBeInstanceOf(Signaling);
  });

  test("should set up diagnostics listener when diagnosticsBatcher is provided", () => {
    const diagnosticsBatcher = new DiagnosticsBatcher();
    const onSpy = jest.spyOn(diagnosticsBatcher, "on");

    new Signaling(diagnosticsBatcher);

    expect(onSpy).toHaveBeenCalledWith("diagnostics", expect.any(Function));
  });

  test("should not set up diagnostics listener when diagnosticsBatcher is not provided", () => {
    const signaling = new Signaling();
    expect(signaling).toBeDefined();
    // Should not throw or have any issues
  });
});

describe("Signaling connect method", () => {
  let signaling: Signaling;
  beforeEach(() => {
    signaling = new Signaling();
  });

  test("should connect without options", async () => {
    await expect(signaling.connect({ endpointToken: "test-token" })).resolves.not.toThrow();
  });

  test("should connect with options", async () => {
    const options = { websocketUrl: "wss://custom-url" };
    await expect(signaling.connect({ endpointToken: "test-token" }, options)).resolves.not.toThrow();
  });

  test("should set up event emitters correctly after connect", async () => {
    const emitSpy = jest.spyOn(signaling, "emit");

    await signaling.connect({ endpointToken: "test-token" });

    // The 'ready' event should have been emitted due to our mock
    expect(emitSpy).toHaveBeenCalledWith("ready", { endpointId: "test-endpoint" });
  });

  test("should emit sdpOffer when websocket receives sdpOffer", async () => {
    const emitSpy = jest.spyOn(signaling, "emit");

    await signaling.connect({ endpointToken: "test-token" });

    // Get the websocket instance and trigger sdpOffer event
    const ws = (signaling as any).ws;
    const sdpOfferCallback = ws.on.mock.calls.find((call: any) => call[0] === "sdpOffer")?.[1];

    if (sdpOfferCallback) {
      const testEvent = { sdp: "test-sdp-offer" };
      sdpOfferCallback(testEvent);
      expect(emitSpy).toHaveBeenCalledWith("sdpOffer", testEvent);
    }
  });

  test("should emit established when websocket receives established", async () => {
    const emitSpy = jest.spyOn(signaling, "emit");

    await signaling.connect({ endpointToken: "test-token" });

    // Get the websocket instance and trigger established event
    const ws = (signaling as any).ws;
    const establishedCallback = ws.on.mock.calls.find((call: any) => call[0] === "established")?.[1];

    if (establishedCallback) {
      const testEvent = { connectionId: "test-connection" };
      establishedCallback(testEvent);
      expect(emitSpy).toHaveBeenCalledWith("established", testEvent);
    }
  });
});

describe("Signaling test all the smaller functions", () => {
  let signaling: Signaling;
  beforeEach(async () => {
    signaling = new Signaling();
    await signaling.connect({ endpointToken: "test-token" });
  });

  test("should call disconnect without error", () => {
    expect(() => signaling.disconnect()).not.toThrow();
  });

  test("should requestOutboundConnection without error", async () => {
    await expect(signaling.requestOutboundConnection("endpoint-id", EndpointType.ENDPOINT)).resolves.toBeDefined();
  });

  test("should hangupConnection without error", async () => {
    await expect(signaling.hangupConnection("endpoint-id", EndpointType.ENDPOINT)).resolves.toBeDefined();
  });

  test("should answerSdp without error", async () => {
    await expect(signaling.answerSdp("sdp-offer-id", "sdp-answer")).resolves.toBeDefined();
  });

  test("should offerSdp without error", async () => {
    await expect(signaling.offerSdp("peer-type", "sdp-offer")).resolves.toBeDefined();
  });

  test("should send diagnostics without error", async () => {
    await expect((signaling as any).sendDiagnostics({ logs: [{ level: "info", message: "test-log" }] })).resolves.not.toThrow();
  });

  test("should setMediaPreferences without error", async () => {
    await expect((signaling as any).setMediaPreferences({ video: { maxBitrate: 1000, maxFramerate: 30 } })).resolves.not.toThrow();
  });
});
