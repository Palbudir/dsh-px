import catalog from '../../config/plugins.json'
import products from '../../config/products.json'
import nativePack from '../../config/native-pack.json'
import nativeDesktop from '../../config/native-desktop.json'
import { assertNativeHostPins, validateProductCatalog } from './product-contract'

validateProductCatalog(products)
assertNativeHostPins(products, { pack: nativePack, desktop: nativeDesktop })
export const PRODUCT_CATALOG = products
export const PACK_VERSION = products.pack.version

/** The same inventory drives plugin builds, the native Pack and artifact assertions. */
export const MANAGED_PLUGIN_NAMES: readonly string[] = catalog.managed
export const managedArtifacts = (prefix = 'packages'): string[] =>
  MANAGED_PLUGIN_NAMES.flatMap((name) =>
    ['index.js', 'client.js'].map((file) => `${prefix}/${name}/lib/${file}`)
  )
