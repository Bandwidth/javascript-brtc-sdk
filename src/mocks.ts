export class MockMediaStream {
  id = "mock-stream-id";
  constructor(tracks?: any[]) {}
  getTracks() {
    return [];
  }
  getAudioTracks() {
    return [{ id: "mock-audio-track" }];
  }
  getVideoTracks() {
    return [];
  }
}

export class MockAudioContext {
  createMediaStreamSource() {
    return { connect: () => {}, disconnect: () => {} };
  }
  createAnalyser() {
    return {};
  }

  createMediaStreamDestination() {
    return {
      stream: new MockMediaStream(),
    };
  }

  createOscillator() {
    return {
      type: "sine",
      frequency: { value: 0 },
      connect: () => {},
      start: () => {},
      disconnect: () => {},
    };
  }

  createGain() {
    return {
      gain: { value: 0 },
      connect: () => {},
      disconnect: () => {},
    };
  }

  createBiquadFilter() {
    return {
      type: "lowpass",
      connect: () => {},
      disconnect: () => {},
    };
  }

  destination = {};
}

export function setupMocks() {
  //@ts-ignore
  global.AudioContext = MockAudioContext;
  //@ts-ignore
  global.MediaStream = MockMediaStream;
}

// Mock navigator.mediaDevices
export function setupNavigatorMocks() {
  const mockEnumerateDevices = jest.fn();
  const mockGetUserMedia = jest.fn();

  Object.defineProperty(global, "navigator", {
    value: {
      mediaDevices: {
        enumerateDevices: mockEnumerateDevices,
        getUserMedia: mockGetUserMedia,
      },
    },
    writable: true,
  });

  return {
    mockEnumerateDevices,
    mockGetUserMedia,
  };
}

// Mock media devices data
export const mockDevices = [
  { deviceId: "1", kind: "audioinput", label: "Microphone 1", groupId: "1" },
  { deviceId: "2", kind: "audioinput", label: "Microphone 2", groupId: "2" },
  { deviceId: "3", kind: "videoinput", label: "Camera 1", groupId: "3" },
  { deviceId: "4", kind: "videoinput", label: "Camera 2", groupId: "4" },
  { deviceId: "5", kind: "audiooutput", label: "Speaker 1", groupId: "5" },
  { deviceId: "6", kind: "audiooutput", label: "Speaker 2", groupId: "6" },
];
