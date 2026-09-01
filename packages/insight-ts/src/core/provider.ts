import type { CapabilityAdapterDefinition, ProviderDefinition } from './types.ts'

export const defineCapabilityAdapter = <const TAdapter extends CapabilityAdapterDefinition>(
    adapter: TAdapter,
): TAdapter => adapter

export const defineProvider = <const TProvider extends ProviderDefinition>(
    provider: TProvider,
): TProvider => provider
