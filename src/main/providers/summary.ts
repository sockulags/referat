// Summary client. Two flavors: OpenAI-compatible chat completions and Anthropic messages.

import type { ConnectionTestResult } from '../../shared/types'
import type { SummaryConfig } from '../settings'
import {
  authHeaders,
  errorDetail,
  HttpError,
  isConnectionError,
  isTimeoutError,
  providerFetch,
  readBodyText,
  TEST_TIMEOUT_MS,
  trimBaseUrl,
  WORK_TIMEOUT_MS
} from './shared'

const ANTHROPIC_DEFAULT_BASE = 'https://api.anthropic.com'
const ANTHROPIC_VERSION = '2023-06-01'

function renderPrompt(template: string, transcript: string): string {
  return template.includes('{{transcript}}')
    ? template.replaceAll('{{transcript}}', transcript)
    : `${template}\n\n${transcript}`
}

// ---- OpenAI-compatible ----

interface ChatCompletionResponse {
  choices?: { message?: { content?: string } }[]
}

async function openAiChat(
  config: SummaryConfig,
  userMessage: string,
  timeoutMs: number,
  maxTokens?: number
): Promise<string> {
  const url = `${trimBaseUrl(config.baseUrl)}/chat/completions`
  const res = await providerFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(config.apiKey) },
    body: JSON.stringify({
      model: config.model,
      messages: [{ role: 'user', content: userMessage }],
      ...(maxTokens ? { max_tokens: maxTokens } : {})
    }),
    signal: AbortSignal.timeout(timeoutMs)
  })
  if (!res.ok) throw new HttpError(res.status, await readBodyText(res))
  const data = (await res.json()) as ChatCompletionResponse
  return data.choices?.[0]?.message?.content?.trim() ?? ''
}

// ---- Anthropic ----

interface AnthropicResponse {
  content?: { type?: string; text?: string }[]
}

async function anthropicMessages(
  config: SummaryConfig,
  userMessage: string,
  timeoutMs: number,
  maxTokens: number
): Promise<string> {
  // Strip a trailing /v1 so a baseUrl that already includes it doesn't become
  // .../v1/v1/messages. The Anthropic path is always <base>/v1/messages.
  const base = (trimBaseUrl(config.baseUrl) || ANTHROPIC_DEFAULT_BASE).replace(/\/v1$/, '')
  const url = `${base}/v1/messages`
  const res = await providerFetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': config.apiKey,
      'anthropic-version': ANTHROPIC_VERSION
    },
    body: JSON.stringify({
      model: config.model,
      max_tokens: maxTokens,
      messages: [{ role: 'user', content: userMessage }]
    }),
    signal: AbortSignal.timeout(timeoutMs)
  })
  if (!res.ok) throw new HttpError(res.status, await readBodyText(res))
  const data = (await res.json()) as AnthropicResponse
  const text = (data.content ?? [])
    .filter((b) => b.type === 'text')
    .map((b) => b.text ?? '')
    .join('')
    .trim()
  return text
}

/** Produce the markdown protocol from the transcript text. */
export async function summarize(transcriptText: string, config: SummaryConfig): Promise<string> {
  const prompt = renderPrompt(config.promptTemplate, transcriptText)
  if (config.apiFlavor === 'anthropic') {
    return anthropicMessages(config, prompt, WORK_TIMEOUT_MS, 4096)
  }
  return openAiChat(config, prompt, WORK_TIMEOUT_MS)
}

export async function testSummaryConnection(config: SummaryConfig): Promise<ConnectionTestResult> {
  try {
    // Minimal real request that exercises auth + model.
    if (config.apiFlavor === 'anthropic') {
      await anthropicMessages(config, 'Svara OK', TEST_TIMEOUT_MS, 1)
    } else {
      await openAiChat(config, 'Svara OK', TEST_TIMEOUT_MS, 1)
    }
    return { ok: true, message: 'Anslutningen fungerar' }
  } catch (err) {
    if (isTimeoutError(err)) {
      return { ok: false, message: 'Servern svarar inte (timeout)', detail: errorDetail(err) }
    }
    if (isConnectionError(err)) {
      return {
        ok: false,
        message: 'Servern svarar inte — kontrollera adressen',
        detail: errorDetail(err)
      }
    }
    if (err instanceof HttpError) {
      if (err.status === 401 || err.status === 403) {
        return { ok: false, message: 'Fel eller saknad API-nyckel', detail: errorDetail(err) }
      }
      if (err.status === 404) {
        return {
          ok: false,
          message: 'Modellen hittades inte — kontrollera modellnamnet',
          detail: errorDetail(err)
        }
      }
      return {
        ok: false,
        message: `Servern svarade med ett fel (${err.status})`,
        detail: errorDetail(err)
      }
    }
    return {
      ok: false,
      message: 'Något gick fel — kontrollera inställningarna',
      detail: errorDetail(err)
    }
  }
}
