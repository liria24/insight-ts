import type { CreateInsightOptions } from '../../core/types.ts'

export type NuxtInsightServerConfig = Omit<CreateInsightOptions, 'history'>

export const defineNuxtInsightConfig = <const TConfig extends NuxtInsightServerConfig>(
    config: TConfig,
): TConfig => config
