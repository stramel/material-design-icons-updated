import { promises as fs } from 'fs'

/**
 * Ensures that the specified directory exists
 * @param {string} dir
 */
export async function ensureDirectory(dir) {
  try {
    await fs.access(dir)
  } catch (ex) {
    await fs.mkdir(dir, { recursive: true })
  }
}

export default fs
