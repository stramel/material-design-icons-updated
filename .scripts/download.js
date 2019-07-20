import ky from 'ky'
import { resolve, join } from 'path'
import { ensureDirectory, readFile, writeFile } from './fs'

// Pull in our current version
const versionFilePath = resolve(__dirname, './VERSION')
let version = await readFile(versionFilePath)

async function hasUpdate() {
  // Fetch the version from google
  const data = await ky
    .get('https://fonts.googleapis.com/icon?family=Material+Icons')
    .text()
  const googleVersion = data.match(
    /^https:\/\/fonts\.gstatic\.com\/s\/materialicons\/v([\d]+)/,
  )

  if (parseInt(googleVersion) > parseInt(version)) {
    version = googleVersion
    return true
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
  return ky.get('https://material.io/tools/icons/static/data.json').json()
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
  baseline: '', // filled
  outline: '_outlined',
  round: '_rounded',
  twotone: '_two_tone',
  sharp: '_sharp',
}

/**
 *
 * @param {Category} category
 * @param {Icon} icon
 * @param {Theme} theme
 */
async function downloadAndSave(category, icon, theme) {
  console.log(`download icon: ${icon.id}`)

  const url = buildIconUrl(theme, icon)
  const size = endUrl.match(/^.*-([0-9]+)px.svg$/)[1]
  const svg = await ky.get(url, { retry: 3 }).text()
  const dir = join(
    __dirname,
    `./${category.name}/ic_${icon.id}${themeNameMap[theme]}_${size}px`,
  )
  await ensureDirectory(dir)
  await writeFile(dir, svg)
}

async function run() {
  try {
    if (!(await hasUpdate())) return

    const manifest = await getManifest()

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
        resolve(__dirname, './manifest.json'),
        JSON.stringify(manifest),
      ),
      writeFile(versionFilePath, version),
    ])

    console.log(`Successfully updated to v${version}!`)
  } catch (err) {
    console.error('UNEXPECTED ERROR:', err)
    throw err
  }
}

run()
