import type { ProviderDefinition, SourceDefinition } from './types.ts'

export const defineSource = <
    const TQuery,
    const TNormalized,
    TData,
    const TMeta extends object = Record<never, never>,
>(
    source: SourceDefinition<TQuery, TNormalized, TData, TMeta>,
): SourceDefinition<TQuery, TNormalized, TData, TMeta> => source

export const defineProvider = <const TProvider extends ProviderDefinition>(
    provider: TProvider,
): TProvider => provider
