// Mock OpenAI-compatible server for local development and pipeline testing.
// Serves /v1/audio/transcriptions, /v1/chat/completions and /v1/models, plus
// the diarization server contract at the root path: /health and /diarize.
// Usage: node scripts/mock-ai-server.mjs [port]
import http from 'node:http'

const port = Number(process.argv[2]) || 8000

const transcript = {
  language: 'sv',
  text: 'Vi öppnade mötet med en genomgång av kvartalets rekryteringar. Anna tar fram en ny annonsmall till fredag. Vi beslutade att flytta introduktionsdagen till den femtonde. Frågan om distansarbete bordlades till nästa möte.',
  segments: [
    { start: 0, end: 6, text: 'Vi öppnade mötet med en genomgång av kvartalets rekryteringar.' },
    { start: 6, end: 12, text: 'Anna tar fram en ny annonsmall till fredag.' },
    { start: 12, end: 18, text: 'Vi beslutade att flytta introduktionsdagen till den femtonde.' },
    { start: 18, end: 24, text: 'Frågan om distansarbete bordlades till nästa möte.' }
  ]
}

const protocol = `## Sammanfattning

Mötet gick igenom kvartalets rekryteringar och planeringen inför introduktionsdagen. Diskussionen var kort och beslutsinriktad.

## Beslut

- Introduktionsdagen flyttas till den 15:e.

## Actionpunkter

- Anna tar fram en ny annonsmall — deadline fredag.

## Öppna frågor

- Policyn för distansarbete bordlades till nästa möte.`

// Matches the mock transcript segments, so merged speakers become S1/S2 alternating.
const diarization = {
  turns: [
    { start: 0, end: 6, speaker: 'S1' },
    { start: 6, end: 12, speaker: 'S2' },
    { start: 12, end: 18, speaker: 'S1' },
    { start: 18, end: 24, speaker: 'S2' }
  ],
  speakers: 2
}

const server = http.createServer((req, res) => {
  const delay = req.url?.includes('transcriptions')
    ? 3000
    : req.url?.startsWith('/diarize')
      ? 1000
      : req.url?.startsWith('/health')
        ? 0
        : 2000
  console.log(`${new Date().toISOString()} ${req.method} ${req.url}`)

  // Drain request body
  req.on('data', () => {})
  req.on('end', () => {
    setTimeout(() => {
      res.setHeader('content-type', 'application/json')
      if (req.url?.startsWith('/v1/models')) {
        res.end(JSON.stringify({ object: 'list', data: [{ id: 'mock-whisper' }, { id: 'mock-llm' }] }))
      } else if (req.url?.startsWith('/v1/audio/transcriptions')) {
        res.end(JSON.stringify(transcript))
      } else if (req.url?.startsWith('/v1/chat/completions')) {
        res.end(
          JSON.stringify({
            id: 'mock',
            choices: [{ index: 0, message: { role: 'assistant', content: protocol }, finish_reason: 'stop' }]
          })
        )
      } else if (req.url?.startsWith('/health')) {
        res.end(JSON.stringify({ status: 'ok', model: 'mock-diarization', device: 'cpu' }))
      } else if (req.url?.startsWith('/diarize')) {
        res.end(JSON.stringify(diarization))
      } else {
        res.statusCode = 404
        res.end(JSON.stringify({ error: 'not found' }))
      }
    }, delay)
  })
})

server.listen(port, () => console.log(`mock-ai-server on http://localhost:${port}/v1`))
