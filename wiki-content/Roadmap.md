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
- **Projects** — group meetings into projects, each with its own default summary template,
  background for the summary model, glossary terms and an overview across all its meetings;
  move meetings in and out of projects — see [Configuration](Configuration#projects).
- **Live transcription** — text appears while the meeting is being recorded, as a preview;
  the full transcript is still made when you stop. On by default when the transcriber runs on
  your computer, opt-in otherwise — see [Configuration](Configuration#live-text-while-recording).
- **Action items you correct and hand off** — the pipeline lists the meeting's action items
  with owner, due date and the moment they were agreed. Edit them in the meeting view, then
  copy them as a list or save them as CSV for Jira or Excel. The protocol carries the same,
  corrected list.
- **Listen to the meeting** — play the recording from any timestamp in the transcript or
  from an action item.

## Planned

The full plan, with one issue per step, is in the pinned
[roadmap issue](https://github.com/sockulags/referat/issues/119).

- **Recording that follows your meetings** — referat notices when a Teams, Zoom or Meet call
  starts and offers to record it, with a reminder to tell participants. Connected to your
  calendar, it fills in title, participants and agenda and can record chosen meetings on
  its own. The calendar is only read on your computer.
- **Ask your meetings** — search every transcript, then ask questions and get answers that
  cite the meeting, the speaker and the moment, with playback from there.

## Explicitly out of scope

- **Task tracking.** referat hands action items off to the tools a team already uses; it has
  no statuses, open-item lists or follow-up boards.

## Parked for now

These aren't planned in the near term, but the architecture is meant not to block them:

- Team sharing of minutes and company-managed settings.
- English UI. The strings are already centralized to prepare for it.
- Code signing with a CA certificate, so the SmartScreen warning on first run goes away. See
  [Installation](Installation) for the current situation.
- macOS and Linux builds.

## Have a request?

Open an issue on [GitHub](https://github.com/sockulags/referat). Feedback shapes what gets
built next.

## Related pages

- **[Home](Home)** · **[Installation](Installation)** · **[FAQ](FAQ)** ·
  **[Architecture](Architecture)**
