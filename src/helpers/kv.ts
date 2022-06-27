const EXPIRATION_TTL = 60 * 60 * 24 * 365

type CachedData = {
  headers: Record<string, string>
  body: string
  expireAt: number
}

type CachedDataDeprecated = {
  headers: Record<string, string>
  body: string
  cacheTtl: string
}

export type KVCacheStoreType = {
  put: (req: Request, res: Response) => Promise<void>
  match: (req: Request) => Promise<[Response | null, { remainingTime: number }]>
  delete: (req: Request) => Promise<void>
}

export const KVCacheStore = (
  kv: KVNamespace,
  ttl: number,
): KVCacheStoreType => {
  return {
    put: async (req, res) => {
      const expireAt = new Date().getTime() + ttl * 1000

      await kv.put(
        req.url,
        JSON.stringify({
          headers: headerToJson(res),
          body: await res.text(),
          expireAt,
        }),
        {
          expirationTtl: EXPIRATION_TTL,
        },
      )
    },

    match: async (req) => {
      const res = await kv.get<CachedData | CachedDataDeprecated>(req.url, {
        type: 'json',
      })
      if (!res) return [null, { remainingTime: 0 }]
      const remainingTime =
        'expireAt' in res
          ? res.expireAt - new Date().getTime()
          : new Date(res.cacheTtl).getTime() - new Date().getTime()

      return [
        restoreResponse(res),
        { remainingTime: Math.max(Math.floor(remainingTime / 1000), 0) },
      ]
    },

    delete: async (req) => {
      await kv.delete(req.url)
    },
  }
}

export const headerToJson = (response: Response): Record<string, string> => {
  return Object.fromEntries(Array.from(response.headers.entries()))
}

export const restoreResponse = ({
  body,
  headers,
}: {
  body: string
  headers: Record<string, string>
}): Response => {
  return new Response(body, {
    headers,
  })
}
