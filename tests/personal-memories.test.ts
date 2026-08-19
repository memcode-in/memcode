import assert from 'node:assert/strict'
import test from 'node:test'

import {
  decodePersonalMemoryPage,
  fetchPersonalMemories,
  PersonalMemoriesHttpError,
} from '../src/lib/personal-memories.ts'

const PAGE = {
  items: [{
    id: 'memory_1',
    domain: 'summary',
    content: 'Ishaan is working on MemCode.',
    content_complete: true,
    metadata: { project: 'memcode' },
    created_at: '2026-08-18T10:22:27.488193+00:00',
    updated_at: null,
  }],
  total_memories: 49,
  limit: 24,
  offset: 24,
  has_more: true,
}

test('decodes a valid paginated personal memory response', () => {
  assert.deepEqual(decodePersonalMemoryPage(PAGE), PAGE)
})

test('rejects inconsistent pagination and malformed items', () => {
  assert.equal(decodePersonalMemoryPage({ ...PAGE, has_more: false }), null)
  assert.equal(decodePersonalMemoryPage({ ...PAGE, items: [{ id: 'missing-fields' }] }), null)
})

test('requests the requested v2 personal memory page with bearer authentication', async () => {
  const originalFetch = globalThis.fetch
  let requestedUrl = ''
  let requestedAuthorization = ''
  globalThis.fetch = async (input, init) => {
    requestedUrl = String(input)
    requestedAuthorization = new Headers(init?.headers).get('Authorization') || ''
    return new Response(JSON.stringify({ status: 'ok', data: PAGE }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  try {
    assert.deepEqual(await fetchPersonalMemories('dashboard-token', { limit: 24, offset: 24 }), PAGE)
    const url = new URL(requestedUrl)
    assert.equal(url.pathname, '/v2/memory')
    assert.equal(url.searchParams.get('limit'), '24')
    assert.equal(url.searchParams.get('offset'), '24')
    assert.equal(requestedAuthorization, 'Bearer dashboard-token')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('preserves authentication failures for the dashboard session handler', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => new Response(null, { status: 401 })
  try {
    await assert.rejects(
      fetchPersonalMemories('expired-token', { limit: 24, offset: 0 }),
      (error: unknown) => error instanceof PersonalMemoriesHttpError && error.status === 401,
    )
  } finally {
    globalThis.fetch = originalFetch
  }
})
