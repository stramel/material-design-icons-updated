import got from 'got'
import { resolve } from 'path'
import queue from 'async.queue'
import Table from 'cli-table3'
import chalk from 'chalk'
import progress from 'cli-progress'
import fs, { ensureDirectory } from './fs.js'

const manifestFilePath = resolve(__dirname, '../manifest.json')
const iconsDir = resolve(__dirname, '../icons')

const bar = new progress.SingleBar({}, progress.Presets.shades_classic)

const errorMap = new Map()

/**
 * @typedef Icon
 * @property {string} name
 * @property {number} version
 * @property {string[]} categories
 * @property {string[]} tags
 * @property {number[]} sizes_px
 * @property {string[]} unsupported_families
 */
/**
 * @typedef Manifest
 * @property {string} host
 * @property {string} asset_url_pattern
 * @property {string[]} families
 * @property {Icon[]} icons
 */

/**
 * @return {Promise<Manifest>}
 */
async function readOldManifest() {
  try {
    await fs.access(manifestFilePath)
    const oldManifest = await fs.readFile(manifestFilePath, 'utf-8')
    return JSON.parse(oldManifest)
  } catch (ex) {
    return {}
  }
}

/**
 * @return {Promise<Manifest>}
 */
async function fetchNewManifest() {
  const { body } = await got('https://fonts.google.com/metadata/icons')
  // Remove these chars to be able to parse the JSON
  const leadingErrantChars = ")]}'"
  const cleaned = body.replace(leadingErrantChars, '')
  return JSON.parse(cleaned)
}

/**
 * @type {Record<string, string>}
 */
const familyThemes = {
  materialicons: 'filled',
  materialiconsoutlined: 'outline',
  materialiconsround: 'round',
  materialiconssharp: 'sharp',
  materialiconstwotone: 'twotone',
}

/**
 *
 * @param {Manifest} manifest
 * @param {Icon} icon
 * @param {string} family
 */
function buildIconUrl(manifest, icon, family, size) {
  const { asset_url_pattern: urlTemplate, host } = manifest
  const urlPath = urlTemplate
    .replace('{family}', family)
    .replace('{icon}', icon.name)
    .replace('{version}', icon.version)
    .replace('{asset}', `${size}px.svg`)
  return `https://${host}${urlPath}?download=true`
}

/**
 * @param {string} category
 * @param {Theme} theme
 * @param {string} iconName
 * @param {string} iconUrl
 */
async function downloadAndSave(category, theme, iconName, iconSize, iconUrl) {
  const { body: svg } = await got(iconUrl)
  const dir = resolve(iconsDir, `${theme}/${category}`)
  await ensureDirectory(dir)
  await fs.writeFile(resolve(dir, `ic_${iconName}_${iconSize}px.svg`), svg)
}

/**
 * @param {string} category
 * @param {Theme} theme
 * @param {string} iconName
 */
async function removeIcon(category, theme, iconName, iconSize) {
  await fs.unlink(
    resolve(iconsDir, `${theme}/${category}/ic_${iconName}_${iconSize}px.svg`),
  )
}

/**
 * @param {Manifest} manifest
 * @return {Record<string, number>}
 */
function mapIconVersions(manifest) {
  const icons = manifest.icons || []
  return icons.reduce((result, icon) => {
    result[icon.name] = icon.version
    return result
  }, {})
}

/**
 * @typedef IconDiff
 * @property {[string, number][]} added
 * @property {[string, {version: number, oldVersion: number}][]} updated
 * @property {[string, number][]} removed
 */

/**
 * @param {Manifest} oldManifest
 * @param {Manifest} newManifest
 * @return {IconDiff}
 */
function diffManifests(oldManifest, newManifest) {
  const oldIconVersions = mapIconVersions(oldManifest)
  const newIconVersions = mapIconVersions(newManifest)

  const diffResult = Object.entries(newIconVersions).reduce(
    (result, [name, version]) => {
      const oldVersion = oldIconVersions[name]

      if (!oldIconVersions[name]) {
        // ADDED (Icon didn't previously exist)
        result.added.push([name, version])
      } else if (oldVersion !== version) {
        // UPDATED (Icon previously existed but version is different)
        result.updated.push([name, { version, oldVersion }])
      }

      return result
    },
    { added: [], updated: [] },
  )

  diffResult.removed = Object.entries(oldIconVersions).filter(
    ([name]) => !newIconVersions[name],
  )

  return diffResult
}

/**
 * @param {IconDiff} diff
 */
function printIconDiff({ added, updated, removed }) {
  const table = new Table({ head: ['Icon', 'Status'], style: { head: [] } })

  added.forEach(([name]) => {
    table.push([name, chalk.green('Added')])
  })

  updated.forEach(([name, { version, oldVersion }]) => {
    table.push([name, chalk.yellow(`Updated (v${oldVersion} --> v${version})`)])
  })

  removed.forEach(([name]) => {
    table.push([name, chalk.red('Deleted')])
  })

  console.log(table.toString())
}

/**
 * @param {IconDiff} diff
 */
function printIconDiffSummary({ added, updated, removed }) {
  const table = new Table({ head: ['Status', 'Count'], style: { head: [] } })

  table.push([chalk.green('Added'), added.length])
  table.push([chalk.yellow('Updated'), updated.length])
  table.push([chalk.red('Removed'), removed.length])

  console.log(table.toString())
}

async function run({ verbose }) {
  try {
    const oldManifest = await readOldManifest()
    const manifest = await fetchNewManifest()

    const diff = diffManifests(oldManifest, manifest)
    if (
      diff.added.length === 0 &&
      diff.updated.length === 0 &&
      diff.removed.length === 0
    ) {
      console.log('No update found')
      return
    }

    if (verbose) {
      printIconDiff(diff)
    } else {
      printIconDiffSummary(diff)
    }

    const q = queue(async ({ task: iconCombo }, callback) => {
      try {
        await downloadAndSave(...iconCombo)
      } catch (err) {
        callback(true)
        return
      }
      callback()
    }, 5)

    const p = new Promise((resolve) => {
      q.drain = resolve
    })

    const iconCominations = []
    const iconRemovalCombinations = []

    const iconsToBeFetched = [
      ...diff.added.map(([name]) => name),
      ...diff.updated.map(([name]) => name),
    ]
    const iconsToBeRemoved = diff.removed.map(([name]) => name)

    // Generating all icon combinations
    manifest.icons.forEach((icon) => {
      if (
        !iconsToBeFetched.includes(icon.name) &&
        !iconsToBeRemoved.includes(icon.name)
      ) {
        return
      }
      icon.categories.forEach((category) => {
        icon.sizes_px.forEach((size) => {
          Object.entries(familyThemes).forEach(([family, theme]) => {
            if (iconsToBeRemoved.includes(icon.name)) {
              iconRemovalCombinations.push([category, theme, icon.name, size])
              return
            }
            const iconUrl = buildIconUrl(manifest, icon, family, size)
            iconCominations.push({
              task: [category, theme, icon.name, size, iconUrl],
            })
          })
        })
      })
    })

    let total = iconCominations.length

    if (iconCominations.length > 0) {
      console.log(`\nDownloading ${total} updated icons:`)
      bar.start(total, 0)

      // Download all Icons
      iconCominations.forEach((task) => {
        q.push(task, (err) => {
          if (err) {
            const tries = errorMap.get(task) || 0
            if (tries < 3) {
              q.push(task)
              errorMap.set(task, tries + 1)
              total += 1
              bar.setTotal(total)
              return
            }
            console.error('Failed to download.')
            exit(1)
            return
          }
          bar.increment()
        })
      })

      await p

      bar.stop()
    }

    if (diff.removed.length > 0) {
      console.log(`\nRemoving ${diff.removed.length} icons:`)
      bar.start(diff.removed.length, 0)

      for (const icon of iconRemovalCombinations) {
        await removeIcon(...icon)
      }

      bar.stop()
    }

    console.log('\nUpdating the manifest')
    await fs.writeFile(manifestFilePath, JSON.stringify(manifest, null, 2))

    console.log('\nSuccessfully updated to the latest icons!')
  } catch (err) {
    console.error('\n\nUNEXPECTED ERROR:', err)
    throw err
  }
}

run({
  verbose: process.env.VERBOSE === 'true',
})
