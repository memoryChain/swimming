import type { Node } from 'cc';
import type { StartupLoadingCover } from './StartupLoadingCover';

export type StartupHandoff = { root: Node | null; joinRoomId: string | null; cover?: StartupLoadingCover };
// 只交接当前场景的首屏节点；业务存档、房间会话仍由原模块单例持有。
const handoffs = new WeakMap<Node, StartupHandoff>();
export function offerStartupHandoff(owner: Node, value: StartupHandoff): void { handoffs.set(owner, value); }
export function takeStartupHandoff(owner: Node): StartupHandoff | undefined {
    const value = handoffs.get(owner);
    handoffs.delete(owner);
    return value;
}
