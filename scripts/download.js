const got = require('got')
import { resolve, join } from 'path'
import queue from 'async.queue'
import progress from 'cli-progress'
import { ensureDirectory, readFile, writeFile } from './fs.js'

// Pull in our current version
const versionFilePath = resolve(__dirname, '../VERSION')

const bar = new progress.SingleBar({}, progress.Presets.shades_classic)

const errorMap = new Map()

/**
 *
 * @param {string} version
 */
async function hasUpdate(version) {
  // Fetch the version from google
  const { body: data } = await got(
    'https://fonts.googleapis.com/icon?family=Material+Icons',
  )
  const { version: googleVersion, hash } = data.match(
    /https:\/\/fonts\.gstatic\.com\/s\/materialicons\/v(?<version>[\d]+)\/(?<hash>[A-Za-z0-9\-]+)\./,
  ).groups

  const hashedVersion = `${googleVersion}-${hash}`
  if (hashedVersion !== version) {
    return hashedVersion
  }

  return false
}

/**
 * @typedef ImageUrls
 * @property {string} baseline
 * @property {string} outline
 * @property {string} round
 * @property {string} sharp
 * @property {string} twotone
 */
/**
 * @typedef {keyof ImageUrls} Theme
 */
/**
 * @typedef Icon
 * @property {string} id
 * @property {ImageUrls} [imageUrls]
 */
/**
 * @typedef Category
 * @property {string} name
 * @property {Icon[]} icons
 */

/**
 * @typedef Manifest
 * @property {string} baseUrl
 * @property {Category[]} categories
 */

/**
 * @return {Promise<Manifest>}
 */
async function getManifest() {
  const { body } = await got('https://material.io/tools/icons/static/data.json')
  return JSON.parse(body)
}

/**
 * @type {Theme[]}
 */
const themes = ['baseline', 'outline', 'round', 'sharp', 'twotone']

/**
 *
 * @param {Icon} icon
 * @param {Theme} theme
 */
function buildIconUrl(icon, theme) {
  return `https://fonts.gstatic.com/s/i/materialicons${theme}/${
    icon.id
  }/v1/24px.svg?download=true`
}

/**
 * @type {Record<Theme, string>}
 */
const themeNameMap = {
  baseline: 'filled',
  outline: 'outline',
  round: 'round',
  twotone: 'twotone',
  sharp: 'sharp',
}

/**
 *
 * @param {Category} category
 * @param {Icon} icon
 * @param {Theme} theme
 */
async function downloadAndSave(category, icon, theme) {
  const url = buildIconUrl(
    icon,
    theme === 'baseline' ? '' : theme === 'outline' ? 'outlined' : theme,
  )
  const { body: svg } = await got(url)
  const dir = join(
    __dirname,
    `../icons/${themeNameMap[theme]}/${category.name}`,
  )
  await ensureDirectory(dir)
  await writeFile(join(dir, `ic_${icon.id}_24px.svg`), svg)
}

async function run() {
  try {
    const version = await readFile(versionFilePath, 'utf8')
    const updatedVersion = await hasUpdate(version)

    if (!updatedVersion) {
      console.log('No update found')
      return
    }
    console.log(`New version found: v${updatedVersion.split('-')[0]}`)

    const manifest = await getManifest()

    const q = queue(async ({ task: iconCombo }, callback) => {
      try {
        await downloadAndSave(...iconCombo)
      } catch (err) {
        callback(true)
        return
      }
      callback()
    }, 5)

    const p = new Promise(resolve => {
      q.drain = resolve
    })

    const iconCominations = []

    // Generating all icon combinations
    manifest.categories.forEach(category => {
      category.icons.forEach(icon => {
        themes.forEach(theme => {
          iconCominations.push({ task: [category, icon, theme] })
        })
      })
    })

    let total = iconCominations.length

    console.log(`Downloading ${total} icons:`)
    bar.start(total, 0)

    // Download all Icons
    iconCominations.forEach(task => {
      q.push(task, err => {
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

    await Promise.all([
      writeFile(
        resolve(__dirname, '../manifest.json'),
        JSON.stringify(manifest),
      ),
      writeFile(versionFilePath, updatedVersion),
    ])

    console.log(`Successfully updated to v${updatedVersion.split('-')[0]}!`)
  } catch (err) {
    console.error('UNEXPECTED ERROR:', err)
    throw err
  }
}

run()
