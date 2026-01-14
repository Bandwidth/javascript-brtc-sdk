import DtmfSender, { MaxToneDurationMs, MinToneDurationMs } from "./dtmfSender";
import { setupMocks } from "./mocks";

beforeAll(() => {
  setupMocks();
});

test("test dtmfSender constructor", () => {
  const mockSender = {
    track: {},
    replaceTrack: jest.fn(),
  } as unknown as RTCRtpSender;

  const dtmfSender = new DtmfSender(mockSender);
  expect(dtmfSender).toBeDefined();
  expect(dtmfSender.sendDtmf).toBeDefined();
  expect(dtmfSender.disconnect).toBeDefined();
});

test("test dtmfSender sendDtmf", () => {
  const mockSender = {
    track: {},
    replaceTrack: jest.fn(),
  } as unknown as RTCRtpSender;

  const dtmfSender = new DtmfSender(mockSender);
  expect(() => dtmfSender.sendDtmf("1", 100)).not.toThrow();
  expect(() => dtmfSender.sendDtmf("A", 500)).not.toThrow();
  expect(() => dtmfSender.sendDtmf("*")).not.toThrow();
  expect(() => dtmfSender.sendDtmf("5", MinToneDurationMs - 10)).toThrow(); // Below minimum
  expect(() => dtmfSender.sendDtmf("Z", 100)).toThrow(); // Invalid character
  expect(() => dtmfSender.sendDtmf("3", MaxToneDurationMs + 1000)).toThrow(); // Above maximum
});
