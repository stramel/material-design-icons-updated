const got = require('got')
import { resolve } from 'path'
import queue from 'async.queue'
import Table from 'cli-table3'
import chalk from 'chalk'
import progress from 'cli-progress'
import { ensureDirectory, exists, readFile, writeFile } from './fs.js'

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
  if (!(await exists(manifestFilePath))) {
    return {}
  }
  const oldManifest = await readFile(manifestFilePath, 'utf8')
  return JSON.parse(oldManifest)
}

/**
 * @return {Promise<Manifest>}
 */
async function fetchNewManifest() {
  const { body } = await got('https://fonts.google.com/metadata/icons')
  // for some reason, the response above includes incorrect leading chars
  // need to remove these chars to be able to parse the JSON
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
function buildIconUrl(manifest, icon, family) {
  const { asset_url_pattern: urlTemplate, host } = manifest
  const urlPath = urlTemplate
    .replace('{family}', family)
    .replace('{icon}', icon.name)
    .replace('{version}', icon.version)
    .replace('{asset}', '24px.svg')
  return `https://${host}${urlPath}?download=true`
}

/**
 * @param {string} category
 * @param {Icon} icon
 * @param {Theme} theme
 */
async function downloadAndSave(category, theme, iconName, iconUrl) {
  const { body: svg } = await got(iconUrl)
  const dir = resolve(iconsDir, `${theme}/${category}`)
  await ensureDirectory(dir)
  await writeFile(resolve(dir, `ic_${iconName}_24px.svg`), svg)
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
 * @param {Manifest} oldManifest
 * @param {Manifest} newManifest
 * @return {Table}
 */
function diffManifests(oldManifest, newManifest) {
  const oldIconVersions = mapIconVersions(oldManifest)
  const newIconVersions = mapIconVersions(newManifest)

  const upgradedIconNames = Object.keys(newIconVersions).filter(
    (newIconName) =>
      !!oldIconVersions[newIconName] &&
      oldIconVersions[newIconName] !== newIconVersions[newIconName],
  )
  const addedIconNames = Object.keys(newIconVersions).filter(
    (newIconName) => !oldIconVersions[newIconName],
  )
  const deletedIconNames = Object.keys(oldIconVersions).filter(
    (oldIconName) => !newIconVersions[oldIconName],
  )

  const table = new Table({ head: ['Icon', 'Status'] })
  upgradedIconNames.forEach((name) => {
    const oldVersion = oldIconVersions[name]
    const newVersion = newIconVersions[name]
    table.push([
      name,
      chalk.yellow(`Upgraded v${oldVersion} --> v${newVersion}`),
    ])
  })
  addedIconNames.forEach((name) => {
    table.push([name, chalk.green('Added new icon')])
  })
  deletedIconNames.forEach((name) => {
    table.push([name, chalk.red('Deleted icon')])
  })

  return table
}

async function run() {
  try {
    const oldManifest = await readOldManifest()
    const newManifest = await fetchNewManifest()

    const diff = diffManifests(oldManifest, newManifest)
    if (diff.length === 0) {
      console.log('No update found')
      return
    }
    console.log(diff.toString())

    const manifest = await fetchNewManifest()

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

    // Generating all icon combinations
    manifest.icons.forEach((icon) => {
      icon.categories.forEach((category) => {
        Object.entries(familyThemes).forEach(([family, theme]) => {
          const iconUrl = buildIconUrl(manifest, icon, family)
          iconCominations.push({
            task: [category, theme, icon.name, iconUrl],
          })
        })
      })
    })

    let total = iconCominations.length

    console.log(`Downloading ${total} icons:`)
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

    await writeFile(manifestFilePath, JSON.stringify(newManifest, null, 2))

    console.log('Successfully downloaded latest icons!')
  } catch (err) {
    console.error('UNEXPECTED ERROR:', err)
    throw err
  }
}

run()
