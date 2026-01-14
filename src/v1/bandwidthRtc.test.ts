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
