# Roadmap

This is an **indicative** roadmap, not a set of promises. Priorities and timing may change.
It exists to show the direction referat is heading.

## Shipped

- **Speaker diarization** — transcript segments are attributed to individual speakers ("who
  said what"), with editable names that flow into the minutes. Optional, via a local
  companion server — see [Speaker Diarization](Speaker-Diarization).
- **Summary templates** — several templates for different readers (minutes, quick recap,
  action items, decision log, follow-up email), chosen when the recording starts. The same
  meeting can get more summaries afterwards, each optionally narrowed to one part of the
  meeting — see [Configuration](Configuration).

## Planned

- **English UI** — the interface is currently Swedish. The strings are already centralized to
  prepare for localization, and English is the next language.
- **Code signing** — sign the Windows installer so the SmartScreen warning on first run goes
  away. See [Installation](Installation) for the current situation.
- **Live transcription** — show text as the meeting happens, rather than only after you stop.

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
