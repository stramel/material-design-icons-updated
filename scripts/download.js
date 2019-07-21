const got = require('got')
import { resolve, join } from 'path'
import { ensureDirectory, readFile, writeFile } from './fs.js'

// Pull in our current version
const versionFilePath = resolve(__dirname, '../VERSION')

/**
 *
 * @param {string} version
 */
async function hasUpdate(version) {
  // Fetch the version from google
  const { body: data } = await got(
    'https://fonts.googleapis.com/icon?family=Material+Icons',
  )
  const { version: googleVersion } = data.match(
    /https:\/\/fonts\.gstatic\.com\/s\/materialicons\/v(?<version>[\d]+)/,
  ).groups

  if (parseInt(googleVersion) > parseInt(version)) {
    return googleVersion
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
  /**
   * @type {string}
   */
  let fileName
  if (icon.imageUrls && icon.imageUrls[theme]) {
    fileName = icon.imageUrls[theme]
  } else {
    fileName = `${theme}-${icon.id}-24px.svg`
  }

  return `https://material.io/tools/icons/static/icons/${fileName}`
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
  console.log(`download icon: ${icon.id}_${theme}`)

  const url = buildIconUrl(icon, theme)
  const size = url.match(/^.*-([0-9]+)px.svg$/)[1]
  const { body: svg } = await got(url)
  const dir = join(
    __dirname,
    `../icons/${themeNameMap[theme]}/${category.name}`,
  )
  await ensureDirectory(dir)
  await writeFile(join(dir, `ic_${icon.id}_${size}px.svg`), svg)
}

async function run() {
  try {
    const version = await readFile(versionFilePath, 'utf8')
    const updatedVersion = await hasUpdate(version)

    if (!updatedVersion) {
      console.log('No update found')
      return
    }
    console.log('New version found: ', updatedVersion)

    const manifest = await getManifest()
    // manifest.categories = manifest.categories.splice(1, 1)

    // Download all Icons
    await Promise.all(
      manifest.categories.map(category => {
        return Promise.all(
          category.icons.map(icon => {
            return Promise.all(
              themes.map(theme => downloadAndSave(category, icon, theme)),
            )
          }),
        )
      }),
    )

    await Promise.all([
      writeFile(
        resolve(__dirname, '../manifest.json'),
        JSON.stringify(manifest),
      ),
      writeFile(versionFilePath, updatedVersion),
    ])

    console.log(`Successfully updated to v${updatedVersion}!`)
  } catch (err) {
    console.error('UNEXPECTED ERROR:', err)
    throw err
  }
}

run()
