Run Vite
cd activity
npm run vite

RUN WebRTC server
cd activity
node --env-file=.env.webrtc .\signaling\webrtcRelay.cjs