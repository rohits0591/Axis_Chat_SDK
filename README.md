# Axis Direct — Custom Chat Widget on the Webex Connect JS SDK

This is a **second, separate build** from the `divicw`/`imichatinit.js` embed on
the main dummy site. That one uses Webex Engage's pre-built widget UI. This one
uses the lower-level **Webex Connect JavaScript SDK** directly, so the entire
UI (header, carousel, bubbles, buttons) is hand-built HTML/CSS to match the
target screenshot exactly, with the SDK wired in for real messaging.

## What's real vs. demo

- **Real**: SDK download (`v1.9.0` from the [official GitHub releases](https://github.com/webex/webexconnect-javascript-sdk/releases)),
  `startup()` → `register()` → `connect()` → `createThread()` → `publishMessage()`
  lifecycle, and rendering of whatever the live asset/flow actually sends back
  (including quick-reply buttons, parsed via `message.getInteractiveData().getQuickReplyData().getButtons()`).
- **Demo fallback**: if no response arrives from the live asset within 4 seconds
  of opening the widget (e.g. because no bot flow is configured yet on asset
  `AX21152542`), the UI shows a clearly-labelled static preview matching the
  screenshot ("Demo preview — no live flow response received yet") so the look
  can be reviewed independent of backend flow status. This never fires once a
  real message has come through.

## File structure

```
axis-direct-sdk/
├── public/
│   ├── index.html              ← page + widget markup
│   ├── style.css                ← shared site styling
│   ├── chat-widget.css          ← widget-specific styling (screenshot match)
│   ├── chat-widget.js           ← SDK wiring + rendering logic
│   ├── sw.min.js                ← service worker (from SDK dist, must sit at root)
│   └── assets/
│       ├── js/
│       │   ├── imi-environments.js       ← your asset config (AX21152542)
│       │   └── webex-connect-sdk.min.js  ← official SDK v1.9.0
│       └── manifest/
│           └── manifest.json             ← Firebase manifest (push, optional)
├── vercel.json
└── README.md
```

## Deploy to Vercel

Same as the other dummy site — no build step:

```bash
npm i -g vercel
cd axis-direct-sdk
vercel
vercel --prod
```

Framework preset **Other**, root directory containing `public/` as the output
directory if using the dashboard import flow.

## Things to verify before this goes anywhere near real users

1. **`appSecret` is sitting in plain text in `imi-environments.js`, which ships
   to every visitor's browser.** That's inherent to this SDK path — anyone can
   view-source it — unlike the `imichatinit.js` widget embed, which only
   exposes GUIDs. For a BFSI production deployment, check with your Webex
   Connect account team whether **JWT Authentication** (symmetric or
   asymmetric — both are documented SDK features) is the expected pattern
   instead of shipping a static `appSecret`, especially given SEBI/DPDP
   sensitivity on the ASL side.
2. **Quick-reply button rendering is written against confirmed SDK method
   names** (`getInteractiveData`, `getQuickReplyData`, `getButtons`,
   `getTitle`, `getValue` — verified directly against the shipped
   `webex-connect-sdk.min.js`), but hasn't been tested against a real message
   from your configured flow yet. Test this against an actual bot response
   before relying on it — attachment shapes can vary by template type
   (quick reply vs. generic template vs. form).
3. **No bot flow is configured on asset `AX21152542`** as far as this build
   knows — that's why the demo fallback exists. Once a flow is live, remove
   or extend the `DEMO_FALLBACK_MS` timeout in `chat-widget.js` as needed.
4. **Push notifications aren't wired up** — the quickstart's Firebase SDK
   scripts and FCM setup were skipped since this is chat-only. Add them
   later per the [FCM setup guide](https://developers.imiconnect.io/docs/setup-fcm-for-chrome-and-firefox-browsers)
   if push becomes a requirement.
5. **Domain allowlisting still applies** — same as the widget-embed site,
   whatever domain this gets deployed to needs to be registered against the
   asset in Webex Connect before it'll authenticate successfully.
