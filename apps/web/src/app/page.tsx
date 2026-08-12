import { getChain } from '@chainsre/shared/chains';

import { publicEnv } from '@/lib/env';

export default function HomePage() {
  const chain = getChain(publicEnv.chainId);

  return (
    <main className="mx-auto flex min-h-screen max-w-3xl flex-col justify-center gap-6 px-6 py-16">
      <div className="flex items-center gap-3">
        <span className="inline-flex h-2.5 w-2.5 rounded-full bg-emerald-400" aria-hidden />
        <span className="text-sm font-medium uppercase tracking-widest text-emerald-400">
          Phase 1 · Foundation
        </span>
      </div>

      <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">ChainSRE</h1>

      <p className="max-w-2xl text-lg text-slate-300">
        A semantic circuit breaker for onchain AI agents. An agent commits a typed intent before it
        acts; ChainSRE compares the confirmed action against that intent and trips a pre-authorized
        guardian when they diverge.
      </p>

      <dl className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-4">
          <dt className="text-xs uppercase tracking-wide text-slate-400">Demo network</dt>
          <dd className="mt-1 text-base font-medium">{chain.name}</dd>
        </div>
        <div className="rounded-lg border border-slate-800 bg-slate-900/50 p-4">
          <dt className="text-xs uppercase tracking-wide text-slate-400">API</dt>
          <dd className="mt-1 break-all text-base font-medium">{publicEnv.apiUrl}</dd>
        </div>
      </dl>
    </main>
  );
}
