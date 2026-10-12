# Roadmap

This is an **indicative** roadmap, not a set of promises. Priorities and timing may change.
It exists to show the direction referat is heading.

## Shipped

- **Me and everyone else** — when system audio is recorded, the transcript separates the
  microphone from the system audio automatically, with no server and no setup — see
  [Speaker Diarization](Speaker-Diarization).
- **Speaker diarization** — transcript segments are attributed to individual speakers ("who
  said what"), with editable names that flow into the minutes. Optional, via a local
  companion server — see [Speaker Diarization](Speaker-Diarization).
- **Summary templates** — several templates for different readers (minutes, quick recap,
  action items, decision log, follow-up email), chosen when the recording starts. The same
  meeting can get more summaries afterwards, each optionally narrowed to one part of the
  meeting — see [Configuration](Configuration).
- **Projects** — group meetings into projects, each with its own default summary template;
  move meetings in and out of projects — see [Configuration](Configuration#projects).
- **Live transcription** — text appears while the meeting is being recorded, as a preview;
  the full transcript is still made when you stop. On by default when the transcriber runs on
  your computer, opt-in otherwise — see [Configuration](Configuration#live-text-while-recording).

## Planned

- **English UI** — the interface is currently Swedish. The strings are already centralized to
  prepare for localization, and English is the next language.
- **Code signing** — sign the Windows installer so the SmartScreen warning on first run goes
  away. See [Installation](Installation) for the current situation.

## Explicitly out of scope for now

These aren't planned in the near term, but the architecture is meant not to block them:

- Calendar integration and team sharing.
- macOS and Linux builds.

## Have a request?

Open an issue on [GitHub](https://github.com/sockulags/referat). Feedback shapes what gets
built next.

## Related pages

- **[Home](Home)** · **[Installation](Installation)** · **[FAQ](FAQ)** ·
  **[Architecture](Architecture)**
