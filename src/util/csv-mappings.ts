import * as fs from 'fs'
import * as path from 'path'

/**
 * CSV-based handle-to-domain mappings for IndieWeb feed
 * Allows explicit mapping of handles to domains for cases where:
 * - Custom handle differs from blog domain (e.g., dominik.social → dominikhofer.me)
 * - bsky.social users want to opt-in to the feed
 */
export class IndiewebMappings {
  private mappings: Map<string, string[]> = new Map()
  private csvPath: string
  private reloadIntervalMs: number
  private reloadTimer?: NodeJS.Timeout

  constructor(
    csvPath: string = path.join(process.cwd(), 'data', 'indieweb-mappings.csv'),
    reloadIntervalMs: number = 5 * 60 * 1000, // 5 minutes
  ) {
    this.csvPath = csvPath
    this.reloadIntervalMs = reloadIntervalMs
  }

  /**
   * Initialize and start periodic reloading
   */
  async start(): Promise<void> {
    await this.load()

    // Reload periodically
    this.reloadTimer = setInterval(() => {
      this.load().catch((err) => {
        console.error('Failed to reload IndieWeb mappings:', err)
      })
    }, this.reloadIntervalMs)
  }

  /**
   * Stop periodic reloading
   */
  stop(): void {
    if (this.reloadTimer) {
      clearInterval(this.reloadTimer)
      this.reloadTimer = undefined
    }
  }

  /**
   * Load mappings from CSV file
   */
  private async load(): Promise<void> {
    try {
      // Check if file exists
      if (!fs.existsSync(this.csvPath)) {
        console.log(`IndieWeb mappings file not found: ${this.csvPath}`)
        console.log('Starting with empty mappings')
        this.mappings.clear()
        return
      }

      const content = fs.readFileSync(this.csvPath, 'utf-8')
      const lines = content.split('\n').filter((line) => line.trim())

      const newMappings = new Map<string, string[]>()
      let lineNumber = 0

      for (const line of lines) {
        lineNumber++

        // Skip header line
        if (lineNumber === 1 && line.toLowerCase().includes('handle')) {
          continue
        }

        // Skip empty lines and comments
        if (!line.trim() || line.trim().startsWith('#')) {
          continue
        }

        // Parse CSV line (simple comma split - handles basic cases)
        const parts = line.split(',').map((p) => p.trim())

        if (parts.length < 2) {
          console.warn(
            `Skipping invalid line ${lineNumber} in ${this.csvPath}: ${line}`,
          )
          continue
        }

        const handle = parts[0].toLowerCase()
        const domain = parts[1].toLowerCase()

        if (!handle || !domain) {
          console.warn(
            `Skipping invalid line ${lineNumber} in ${this.csvPath}: empty handle or domain`,
          )
          continue
        }

        // Store mapping (one handle can map to multiple domains)
        const existing = newMappings.get(handle) || []
        existing.push(domain)
        newMappings.set(handle, existing)
      }

      this.mappings = newMappings
      console.log(
        `Loaded ${this.mappings.size} IndieWeb handle mappings from ${this.csvPath}`,
      )
    } catch (err) {
      console.error(`Failed to load IndieWeb mappings from ${this.csvPath}:`, err)
      // Keep existing mappings on error
    }
  }

  /**
   * Get domains for a given handle
   * @param handle - User's handle (e.g., "dominik.social")
   * @returns Array of domains, or empty array if not found
   */
  getDomainsForHandle(handle: string): string[] {
    return this.mappings.get(handle.toLowerCase()) || []
  }

  /**
   * Check if a handle has any mappings
   */
  hasMapping(handle: string): boolean {
    return this.mappings.has(handle.toLowerCase())
  }

  /**
   * Get all mappings (for debugging)
   */
  getAllMappings(): Map<string, string[]> {
    return new Map(this.mappings)
  }
}
