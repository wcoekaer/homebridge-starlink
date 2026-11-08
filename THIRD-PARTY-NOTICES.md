# Third-party notices

## Manrope

The dashboard uses Manrope by the Manrope Project Authors.

- Source: https://github.com/google/fonts/tree/main/ofl/manrope
- Copyright 2018 The Manrope Project Authors
- License: SIL Open Font License 1.1; the complete text is in `assets/OFL.txt`.
- `Manrope-Regular.ttf` and `Manrope-Bold.ttf` are static instances of the upstream variable font at weights 400 and 700, generated with FontTools. The original variable font is also included.

## Runtime packages

The package manager installs the gRPC libraries, Resvg, Sharp, and optional FFmpeg distribution as dependencies. Their respective licenses and notices remain with those packages. This package does not embed their source code or FFmpeg binaries in its npm archive.

The optional `ffmpeg-for-homebridge` package manages its own platform-specific binary download. Its FFmpeg build includes components governed by their own licenses; consult that package's documentation and distribution notices.

## Protocol compatibility

`proto/starlink.proto` is a minimal wire schema generated from the local dish's gRPC reflection descriptors. The client exposes read-only status and history requests. Protocol names belong to their respective owners. No Starlink account credentials or device identifiers are distributed with this project.
