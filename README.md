# webview-sync — Scratch 3 / Gandi IDE extension

Stage overlay web view: shows a live web page on top of the Scratch stage and keeps it pixel-aligned.

## Use in Gandi
Extensions -> Custom extension -> URL:

    https://<user>.github.io/<repo>/ext/webview-sync.js

## Blocks
- show / hide page on stage, navigate, reload, remove layer
- margin, rect x/y/w/h, fill stage, zoom %, mouse pass-through, force sync
- reporters: current URL, visible?, stage pixel size, web->scratch coordinate conversion

## Note
Sites that send X-Frame-Options / CSP frame-ancestors (Baidu, Taobao, Bilibili...) cannot be embedded - browser security, not a bug.

## Build
`node ext/make_index.js` regenerates ext/index.html from ext/webview-sync.js.
