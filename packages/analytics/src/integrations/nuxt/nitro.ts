export function configureMaintenanceTask(nitroConfig: unknown, handler: string): void {
    const nitro = requireRecord(nitroConfig, 'Nitro config')
    recordAt(nitro, 'experimental').tasks = true
    recordAt(nitro, 'tasks')['analytics:maintenance'] ??= {
        description: 'Refresh and prune analytics archive partitions',
        handler,
    }
}

export function configureR2Storage(nitroConfig: unknown, base: string, binding: string): void {
    const nitro = requireRecord(nitroConfig, 'Nitro config')
    const storage = recordAt(nitro, 'storage')
    storage[base] ??= { binding, driver: 'cloudflare-r2-binding' }
}

function recordAt(parent: Record<string, unknown>, key: string): Record<string, unknown> {
    const current = parent[key]
    if (current === undefined) {
        const record: Record<string, unknown> = {}
        parent[key] = record
        return record
    }
    return requireRecord(current, `Nitro ${key}`)
}

function requireRecord(value: unknown, name: string): Record<string, unknown> {
    if (!isRecord(value)) {
        throw new TypeError(`${name} must be an object`)
    }
    return value
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}
