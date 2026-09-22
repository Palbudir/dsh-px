export interface NetworkStatus {
  source: 'environment' | 'home-env' | 'system' | 'direct' | 'disabled' | 'unsupported' | 'unavailable'
  checkedAt: string
  protocols: string[]
  message: string
}
