import fs from 'fs'
import { promisify } from 'utils'

export const exists = promisify(fs.exists)
export const mkdir = promisify(fs.mkdir)
export const readFile = promisify(fs.readFile)
export const writeFile = promisify(fs.writeFile)

/**
 * Ensures that the specified directory exists
 * @param {string} dir
 */
export async function ensureDirectory(dir) {
  if (!(await exists(dir))) {
    await mkdir(dir, { recursive: true })
  }
}
