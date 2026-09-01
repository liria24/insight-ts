import { createStorage } from 'unstorage'
import memoryDriver from 'unstorage/drivers/memory'

import { createNitroHistoryRepository } from '../src/integrations/nitro/index.ts'
import { historyRepositoryConformance } from './support/history-repository-conformance.ts'

historyRepositoryConformance('Nitro', () =>
    createNitroHistoryRepository(createStorage({ driver: memoryDriver() })),
)
