import { KVCacheStore, KVCacheStoreType } from './helpers/kv'

const TTL_DEFAULT = 60
const PROXY_DEFAULT = (r: Request) => r

type RequestProxy = (req: Request) => Request

type Context = { waitUntil: (promise: Promise<any>) => void }

/**
 * SwrOptions
 * @property {number} ttl TTL of the cache (in seconds). Default is 60 seconds.
 * @property {RequestProxy} proxy Function for proxying requests
 * @property {boolean} debug Output log for debugging
 */
type SwrOptions = { ttl?: number; proxy?: RequestProxy; debug?: boolean }

/**
 * @property {MatchFunc} match Search the cache using the request as a key. If there is a cache, return it and re-verify it according to the expiration.
 * @property {PutFunc} put Cache the response with the request as the key.
 * @property {RevalidateFunc} revalidate Specify the request to revalidate the cache.
 * @property {ClearFunc} clear Specify the request to clear the cache.
 */
type SWR = {
  match: MatchFunc
  put: PutFunc
  revalidate: RevalidateFunc
  clear: ClearFunc
}

/**
 * makeSwr
 * @param remoteRequest
 * @param kv KV namespace for storing cache
 * @param context The fetch event or context with {@link https://developers.cloudflare.com/workers/runtime-apis/fetch-event/#supported-fetchevent-properties waitUntil}
 * @param options {@link SwrOptions}
 *
 * @returns a model of the {@link SWR}
 */
export const makeSwr = (
  remoteRequest: Request,
  kv: KVNamespace,
  context: Context,
  options?: SwrOptions,
): SWR => {
  const {
    ttl = TTL_DEFAULT,
    proxy = PROXY_DEFAULT,
    debug = false,
  } = options ?? {}

  const args: MakeFunctionArgs = {
    request: remoteRequest,
    ttl,
    storeApi: KVCacheStore(kv, ttl),
    logger: (...args: unknown[]) => {
      if (debug) console.log(...args)
    },
    proxy,
    context,
  }

  return {
    match: makeMatchFunc(args),
    put: makePutFunc(args),
    revalidate: makeRevalidateFunc(args),
    clear: makeClearFunc(args),
  }
}

type MakeFunctionArgs = {
  request: Request
  ttl: number
  storeApi: KVCacheStoreType
  context: Context
  proxy: RequestProxy
  logger: (...args: unknown[]) => void
}

/**
 * MatchFunc
 * @property {boolean} forceRevalidate If set to true, it will be forcibly revalidated regardless of the cache expiration.
 * @property {'fetch' | 'error'} onNotMatched Set 'error' to throw a `NotMatchedError` when the cache is not found. The default is 'fetch'
 */
type MatchFunc = (option?: {
  forceRevalidate?: boolean
  onNotMatched?: 'fetch' | 'error'
}) => Promise<Response>

const makeMatchFunc = (args: MakeFunctionArgs): MatchFunc => {
  const { request, storeApi, context, proxy, logger } = args
  const proxiedRequest = proxy(request)
  const revalidate = makeRevalidateFunc(args)

  return async (option) => {
    const { forceRevalidate = false, onNotMatched = 'fetch' } = option ?? {}

    const [kvCache, { remainingTime }] = await storeApi.match(request)

    if (forceRevalidate || remainingTime < 1 || !kvCache)
      context.waitUntil(revalidate())

    if (kvCache) {
      logger('hit the cache by KV')
      return kvCache
    }

    logger('no hit caches')
    if (onNotMatched === 'error')
      throw new NotMatchedError('Caches are not matched', request)
    return fetch(proxiedRequest)
  }
}

export class NotMatchedError extends Error {
  request: Request
  constructor(message: string, request: Request) {
    super(message)
    this.request = request
    this.name = new.target.name
  }
}

type RevalidateFunc = () => Promise<void>

const makeRevalidateFunc = (args: MakeFunctionArgs): RevalidateFunc => {
  const { logger, proxy, request } = args
  const proxiedRequest = proxy(request)
  const clear = makeClearFunc(args)
  const put = makePutFunc(args)

  return async () => {
    logger('revalidate the cache')
    const res = await fetch(proxiedRequest)

    if (400 <= res.status && res.status <= 499) await clear()
    else if (200 <= res.status && res.status <= 299) await put(res)
  }
}

type ClearFunc = () => Promise<void>

const makeClearFunc = ({
  request,
  storeApi,
  logger,
}: MakeFunctionArgs): ClearFunc => {
  return async () => {
    await storeApi.delete(request)
    logger('deleted the cache')
  }
}

type PutFunc = (res: Response) => Promise<void>

const makePutFunc = (args: MakeFunctionArgs): PutFunc => {
  const { storeApi, request, logger } = args

  return async (res) => {
    await storeApi.put(request, res)
    logger('created the cache')
  }
}
