import { director, Node } from 'cc';

// 只保留当前大厅的一组根节点；比赛期间全部停用，返回后解除常驻。
let retained: { roots: Node[]; resume: () => void } | null = null;

export function retainLobbyForRace(roots: (Node | null)[], resume: () => void): void {
    if (retained) throw new Error('大厅已暂存');
    const valid = roots.filter((node): node is Node => !!node?.isValid);
    retained = { roots: valid, resume };
    for (const node of valid) {
        director.addPersistRootNode(node);
        node.active = false;
    }
}

export function resumeLobbyAfterRace(): boolean {
    const session = retained;
    retained = null;
    if (!session) return false;
    for (const node of session.roots) director.removePersistRootNode(node);
    if (session.roots.some(node => !node.isValid)) return false;
    // 预览和弹窗由页面恢复逻辑决定显隐，不能全部无条件启用。
    session.roots[0].active = true;
    session.resume();
    return true;
}
