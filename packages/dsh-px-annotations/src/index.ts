import type { WorkspaceFeatureContext } from '../../dsh-px-workspace/src/index'
export const name = 'dsh-px-annotations'
export const inject = ['pxWorkspace']
export function apply(ctx: WorkspaceFeatureContext): void {
  ctx.pxWorkspace.mount(ctx, 'annotations')
}
