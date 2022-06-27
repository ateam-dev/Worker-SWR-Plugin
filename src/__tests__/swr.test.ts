import { MockServer } from 'jest-mock-server'
import waitForExpect from 'wait-for-expect'
import { headerToJson, KVCacheStore } from '../helpers/kv'
import { makeSwr } from '../swr'
import { NotMatchedError } from '../swr'

declare global {
  function getMiniflareBindings(): {
    CACHE: KVNamespace
  }
}

const waitUntilMock = jest.fn()
const context = {
  waitUntil: waitUntilMock,
} as unknown as FetchEvent

const originServer = new MockServer()

beforeAll(async () => {
  await originServer.start()
})

beforeEach(async () => {
  jest.resetAllMocks()
  await originServer.reset()
  originServer.get(/.*/).mockImplementation((ctx) => {
    const [, status = 200] = ctx.request.url.match(/\/status-(\d{3})\//) ?? []
    ctx.status = Number(status)
    ctx.body = `this is origin response; ${ctx.request.url}`
  })
})

afterAll(async () => {
  await originServer.stop()
})

test('If there is no cache, the response is returned from the origin and revalidated.', async () => {
  const { CACHE } = getMiniflareBindings()
  const remoteRequest = new Request(
    `${originServer.getURL().origin}/first-landing/`,
  )
  const kvStore = KVCacheStore(CACHE, 60)
  const swr = makeSwr(remoteRequest, CACHE, context, { debug: true })
  const res = await swr.match()

  expect(res.status).toBe(200)
  expect(await res.text()).toBe('this is origin response; /first-landing/')
  await waitForExpect(async () => {
    const [cachedRes] = await kvStore.match(remoteRequest)
    expect(await cachedRes?.text()).toBe(
      'this is origin response; /first-landing/',
    )
  })
  expect(waitUntilMock).toBeCalledTimes(1)
})

test('If there is a cache and it is within the expiration date, no revalidation will occur.', async () => {
  const { CACHE } = getMiniflareBindings()
  const remoteRequest = new Request(
    `${originServer.getURL().origin}/second-landing/`,
  )
  const kvStore = KVCacheStore(CACHE, 60)
  await kvStore.put(
    remoteRequest,
    new Response('this is cached response; /second-landing/'),
  )
  const swr = makeSwr(remoteRequest, CACHE, context)
  const res = await swr.match()

  expect(res.status).toBe(200)
  expect(await res.text()).toBe('this is cached response; /second-landing/')
  expect(waitUntilMock).not.toBeCalled()
})

test('If the cache is expired, return the cache and revalidate', async () => {
  const { CACHE } = getMiniflareBindings()
  const remoteRequest = new Request(
    `${originServer.getURL().origin}/third-landing/`,
  )
  const kvStore = KVCacheStore(CACHE, 0)
  await kvStore.put(
    remoteRequest,
    new Response('this is expired cached response'),
  )
  const swr = makeSwr(remoteRequest, CACHE, context)
  const res = await swr.match()

  expect(res.status).toBe(200)
  expect(await res.text()).toBe('this is expired cached response')
  await waitForExpect(async () => {
    const [cachedRes] = await kvStore.match(remoteRequest)
    expect(await cachedRes?.text()).toBe(
      'this is origin response; /third-landing/',
    )
  })
  expect(waitUntilMock).toBeCalledTimes(1)
})

test("Set `onNotMatched: 'error'` to throw an error when there is no cache", async () => {
  const { CACHE } = getMiniflareBindings()
  const remoteRequest = new Request(
    `${originServer.getURL().origin}/no-caches/`,
  )
  const kvStore = KVCacheStore(CACHE, 0)
  const swr = makeSwr(remoteRequest, CACHE, context)
  const promise = swr.match({ onNotMatched: 'error' })

  await expect(promise).rejects.toBeInstanceOf(NotMatchedError)
  await waitForExpect(async () => {
    const [cachedRes] = await kvStore.match(remoteRequest)
    expect(await cachedRes?.text()).toBe('this is origin response; /no-caches/')
  })
  expect(waitUntilMock).toBeCalledTimes(1)
})

test('Set forceRevalidate to revalidate regardless of expiration', async () => {
  const { CACHE } = getMiniflareBindings()
  const remoteRequest = new Request(
    `${originServer.getURL().origin}/force-revalidate/`,
  )
  const kvStore = KVCacheStore(CACHE, 60)
  await kvStore.put(
    remoteRequest,
    new Response('this is cached response; /force-revalidate/'),
  )
  const swr = makeSwr(remoteRequest, CACHE, context)
  const res = await swr.match({ forceRevalidate: true })

  expect(res.status).toBe(200)
  expect(await res.text()).toBe('this is cached response; /force-revalidate/')
  await waitForExpect(async () => {
    const [cachedRes] = await kvStore.match(remoteRequest)
    expect(await cachedRes?.text()).toBe(
      'this is origin response; /force-revalidate/',
    )
  })
  expect(waitUntilMock).toBeCalledTimes(1)
})

test('Delete cache if status 4xx upon revalidation', async () => {
  const { CACHE } = getMiniflareBindings()
  const remoteRequest = new Request(
    `${originServer.getURL().origin}/status-404/`,
  )
  const kvStore = KVCacheStore(CACHE, 0)
  await kvStore.put(remoteRequest, new Response('this is cached response'))
  const swr = makeSwr(remoteRequest, CACHE, context)
  const res = await swr.match()

  expect(res.status).toBe(200)
  expect(await res.text()).toBe('this is cached response')
  await waitForExpect(async () => {
    const [cachedRes] = await kvStore.match(remoteRequest)
    expect(cachedRes).toBeNull()
  })
  expect(waitUntilMock).toBeCalledTimes(1)
})

test('Can proxy requests to origin', async () => {
  const { CACHE } = getMiniflareBindings()
  const remoteRequest = new Request(
    `${originServer.getURL().origin}/target-of-proxy/`,
  )
  const kvStore = KVCacheStore(CACHE, 60)
  const swr = makeSwr(remoteRequest, CACHE, context, {
    proxy: (req) => {
      const url = new URL(req.url)
      if (url.pathname.match('proxy')) {
        url.pathname = '/proxied' + url.pathname
        return new Request(url.toString(), req)
      }
      return req
    },
  })
  const res = await swr.match()

  expect(res.status).toBe(200)
  expect(await res.text()).toBe(
    'this is origin response; /proxied/target-of-proxy/',
  )
  await waitForExpect(async () => {
    const [cachedRes] = await kvStore.match(remoteRequest)
    expect(await cachedRes?.text()).toBe(
      'this is origin response; /proxied/target-of-proxy/',
    )
  })
  expect(waitUntilMock).toBeCalledTimes(1)
})

test('Compatibility with old-style KV data (`cacheTtl`)', async () => {
  const { CACHE } = getMiniflareBindings()
  const remoteRequest = new Request(
    `${originServer.getURL().origin}/old-style-kv/`,
  )
  const originResponse = new Response('this is cached response; /old-style-kv/')
  const oneMinLater = new Date()
  oneMinLater.setSeconds(60)
  await CACHE.put(
    remoteRequest.url,
    JSON.stringify({
      headers: {},
      body: await originResponse.text(),
      cacheTtl: oneMinLater.toISOString(),
    }),
    {
      expirationTtl: 60,
    },
  )

  const swr = makeSwr(remoteRequest, CACHE, context)
  const res = await swr.match()

  expect(res.status).toBe(200)
  expect(await res.text()).toBe('this is cached response; /old-style-kv/')
  expect(waitUntilMock).not.toBeCalled()
})

test('Compatibility with old-style KV data (`cacheTtl`) is expired', async () => {
  const { CACHE } = getMiniflareBindings()
  const remoteRequest = new Request(
    `${originServer.getURL().origin}/old-style-kv-expired/`,
  )
  const originResponse = new Response('this is cached response; /old-style-kv/')
  const now = new Date()
  await CACHE.put(
    remoteRequest.url,
    JSON.stringify({
      headers: {},
      body: await originResponse.text(),
      cacheTtl: now.toISOString(),
    }),
    {
      expirationTtl: 60,
    },
  )

  const swr = makeSwr(remoteRequest, CACHE, context)
  const res = await swr.match()

  expect(res.status).toBe(200)
  expect(await res.text()).toBe('this is cached response; /old-style-kv/')
  expect(waitUntilMock).toBeCalledTimes(1)
})
