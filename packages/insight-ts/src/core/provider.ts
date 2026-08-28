import type { ProviderDefinition } from './types.ts'

export const defineProvider = <const TProvider extends ProviderDefinition>(
    provider: TProvider,
): TProvider => provider

export type {
    BreakdownResult,
    DimensionDefinition,
    DimensionInput,
    EventDestination,
    HistoryDeclaration,
    MetricDefinition,
    MetricInput,
    ProviderDefinition,
    ReportSourceDefinition,
    SeriesResult,
    SnapshotResult,
    SummaryResult,
} from './types.ts'
