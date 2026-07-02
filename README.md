# BandwidthRTC Node SDK Documentation

## Initialize the BandwidthRTC Node SDK

```javascript
import BandwidthRtc from "bandwidth-rtc";

const bandwidthRtc = new BandwidthRtc();
```

## API Methods

### connect

- Params:
  - authParams: the device token to connect with
  - options: optional SDK settings (can be omitted)
    - websocketUrl: override the default Bandwidth RTC connection url (this should not generally be needed)
- Description: connect device to the Bandwidth RTC platform

```javascript
await bandwidthRtc.connect({
  deviceToken: deviceToken,
});
```

### publish

- Params:
  - input: the input to publish; this can be an instance of:
    - mediaStream: An already existing media stream such as a screen share
      - Type: MediaStream
- Return:
  - rtcStream: a media stream with the supplied media stream constraints
    - Type: RtcStream
- Description: publish media

#### Publish with default settings:

```javascript
let rtcStream: RtcStream = await bandwidthRtc.publish();
```

#### Publish audio only

#### Publish with customized constraints

```javascript
const mediaConstraints: MediaStreamConstraints = {
  audio: {
    autoGainControl: true,
    channelCount: 1,
    deviceId: "default",
    echoCancellation: true,
    latency: 0.01,
    noiseSuppression: true,
    sampleRate: 48000,
    sampleSize: 16,
  }
};
let microphoneStream = await navigator.mediaDevices.getUserMedia(mediaConstraints);
let sourceNode = audioContext.createMediaStreamSource(microphoneStream);
let rtcStream: RtcStream = await bandwidthRtc.publish(mediaConstraints);
```

#### Publish with existing media stream

```javascript
let screenShare = await navigator.mediaDevices.getDisplayMedia({
  video: true,
});
let rtcStream: RtcStream = await bandwidthRtc.publish(screenShare);
```

Please see the following resources for more information on MediaStreamConstraints and MediaTrackConstraints that can be specified here:

- https://developer.mozilla.org/en-US/docs/Web/API/MediaStreamConstraints
- https://developer.mozilla.org/en-US/docs/Web/API/MediaTrackConstraints

### disconnect

- Description: disconnect device from the Bandwidth RTC platform

### DTMF

- Description: send DTMF tones via the browser's native `RTCDTMFSender` (RFC 4733). Tones are forwarded as telephone-event RTP packets by the Bandwidth gateway.
- Params:
  - tone: the digits to send, as a string, chosen from the set of valid DTMF characters [0-9,*,#,A-D,\,]
  - streamId (optional): the stream to send the tone on; defaults to all published streams
  - duration (optional): tone duration in milliseconds, between 40 and 6000 (default: 100)
  - interToneGap (optional): gap between tones in milliseconds, minimum 30 (default: 70)
- Returns: `true` if the tones were queued on at least one stream, `false` otherwise (e.g. no audio stream published yet, or the telephone-event codec has not been negotiated)

```javascript
bandwidthRtc.sendDtmf("3");
bandwidthRtc.sendDtmf("313,3211*#");
bandwidthRtc.sendDtmf("5", undefined, 200, 100); // 200ms tone, 100ms gap
```

## Event Listeners

### onStreamAvailable

- Description: called when a media stream is available to attach to the UI. This will be called for every independent stream presented to the Participant, meaning that if a new remote Participant is added to a subscribed Session a new stream will be made available to the browser, and will need to be presented to the UI for consumption by the user.

```javascript
bandwidthRtc.onStreamAvailable((event) => {
  console.log(
    `A stream is available with streamId=${event.mediaStream.id}, its media types are ${event.mediaTypes} and the stream itself is ${event.mediaStream}`,
  );
});
```

### onStreamUnavailable

- Description: called when a media stream is now unavailable and should be removed from the UI

```javascript
bandwidthRtc.onStreamUnavailable((event) => {
  console.log(
    `The stream with streamId=${event.mediaStream.id} is now unavailable and should be removed from the UI because the media is likely to freeze imminently.`,
  );
});
```

### Notes

- Pinning `rpc-websockets` library to version `7.10.0` so that the transpiling and compilation of the RPC Client works.
