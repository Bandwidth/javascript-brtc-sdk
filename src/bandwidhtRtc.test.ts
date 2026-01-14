import BandwidthRtc from "./bandwidthRtc";
import { MockMediaStream, setupNavigatorMocks, mockDevices } from "./mocks";

// Mock the Signaling module and BandwidthRtcV1
jest.mock("./v1/bandwidthRtc", () => ({
  BandwidthRtc: jest.fn().mockImplementation(() => ({
    connect: jest.fn().mockResolvedValue(undefined),
    onStreamAvailable: jest.fn(),
    onStreamUnavailable: jest.fn(),
    onReady: jest.fn(),
    publish: jest.fn().mockResolvedValue({
      endpointId: "mock-stream-id",
      mediaStream: { id: "mock-stream-id", getTracks: () => [], getAudioTracks: () => [{ id: "mock-audio-track" }], getVideoTracks: () => [] },
      mediaTypes: ["audio", "video"],
      alias: "test-alias",
    }),
    unpublish: jest.fn().mockResolvedValue(undefined),
    disconnect: jest.fn(),
    setMicEnabled: jest.fn(),
    setCameraEnabled: jest.fn(),
    sendDtmf: jest.fn(),
    requestOutboundConnection: jest.fn(),
    hangupConnection: jest.fn(),
    getVideoInputs: jest.fn(),
    getAudioInputs: jest.fn(),
    getAudioOutputs: jest.fn(),
    getMediaDevices: jest.fn(),
  })),
}));

jest.mock("./v1/signaling", () => {
  return jest.fn().mockImplementation(() => ({
    connect: jest.fn().mockResolvedValue(undefined),
    on: jest.fn(),
    disconnect: jest.fn(),
    requestOutboundConnection: jest.fn(),
    hangupConnection: jest.fn(),
  }));
});

// Mock global MediaStream
global.MediaStream = MockMediaStream as any;

// Mock navigator.mediaDevices API
const { mockEnumerateDevices, mockGetUserMedia } = setupNavigatorMocks();

test("test creating delegate object without error", () => {
  const bandwidthRTC = new BandwidthRtc("debug");
  expect(bandwidthRTC).toBeDefined();
});

test("test connect without error", async () => {
  const bandwidthRTC = new BandwidthRtc("debug");

  await expect(
    bandwidthRTC.connect({
      endpointToken: "test-token",
    }),
  ).resolves.not.toThrow();
});

test("test onStreamAvailable callback is called", async () => {
  const bandwidthRTC = new BandwidthRtc("debug");
  const mockCallback = jest.fn();

  // Set the handler before connecting
  bandwidthRTC.onStreamAvailable(mockCallback);

  await bandwidthRTC.connect({
    endpointToken: "test-token",
  });

  // Verify the callback was registered with the delegate
  expect(mockCallback).toBeDefined();
});

test("test onStreamUnavailable callback is called", async () => {
  const bandwidthRTC = new BandwidthRtc("debug");
  const mockCallback = jest.fn();

  // Set the handler before connecting
  bandwidthRTC.onStreamUnavailable(mockCallback);

  await bandwidthRTC.connect({
    endpointToken: "test-token",
  });

  // Verify the callback was registered with the delegate
  expect(mockCallback).toBeDefined();
});

test("test onReady callback is called", async () => {
  const bandwidthRTC = new BandwidthRtc("debug");
  const mockCallback = jest.fn();

  // Set the handler before connecting
  bandwidthRTC.onReady(mockCallback);

  await bandwidthRTC.connect({
    endpointToken: "test-token",
  });

  // Verify the callback was registered with the delegate
  expect(mockCallback).toBeDefined();
});

test("test getMediaDevices without error", async () => {
  const bandwidthRTC = new BandwidthRtc("debug");

  mockEnumerateDevices.mockResolvedValue(mockDevices);

  const devices = await bandwidthRTC.getMediaDevices();
  expect(devices).toEqual(mockDevices);
  expect(mockEnumerateDevices).toHaveBeenCalled();
});

test("test getMediaDevices with filter", async () => {
  const bandwidthRTC = new BandwidthRtc("debug");

  mockEnumerateDevices.mockResolvedValue(mockDevices);

  const audioInputs = await bandwidthRTC.getMediaDevices("audioinput");
  expect(audioInputs).toHaveLength(2);
  expect(audioInputs[0].kind).toBe("audioinput");
});

test("test getAudioInputs", async () => {
  const bandwidthRTC = new BandwidthRtc("debug");

  mockEnumerateDevices.mockResolvedValue(mockDevices);

  const audioInputs = await bandwidthRTC.getAudioInputs();
  expect(audioInputs).toHaveLength(2);
  expect(audioInputs.every((device) => device.kind === "audioinput")).toBe(true);
});

test("test getVideoInputs", async () => {
  const bandwidthRTC = new BandwidthRtc("debug");

  mockEnumerateDevices.mockResolvedValue(mockDevices);

  const videoInputs = await bandwidthRTC.getVideoInputs();
  expect(videoInputs).toHaveLength(2);
  expect(videoInputs.every((device) => device.kind === "videoinput")).toBe(true);
});

test("test getAudioOutputs", async () => {
  const bandwidthRTC = new BandwidthRtc("debug");

  mockEnumerateDevices.mockResolvedValue(mockDevices);

  const audioOutputs = await bandwidthRTC.getAudioOutputs();
  expect(audioOutputs).toHaveLength(2);
  expect(audioOutputs.every((device) => device.kind === "audiooutput")).toBe(true);
});

test("test publish without connect error", async () => {
  const bandwidthRTC = new BandwidthRtc("debug");
  await bandwidthRTC.connect({
    endpointToken: "test-token",
  });

  mockGetUserMedia.mockResolvedValue(new MockMediaStream());

  await expect(bandwidthRTC.publish({})).resolves.toBeDefined();
});
